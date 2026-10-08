/**
 * Profit calculation engine
 * Migrated from original Netlify functions with multi-store support
 */
import { shippingCountry } from "../shared/shipping-regions";

interface CogsConfigMap {
  [variantId: string]: number; // variantId -> cogs value
}

type ShippingConfigMap = Record<string, any>;

interface LineItem {
  variant_id?: number | string;
  product_id?: number | string;
  title?: string;
  name?: string;
  quantity: number;
  price?: string | number;
  requires_shipping?: boolean;
}

interface ShopifyOrder {
  id: string;
  order_number: number;
  created_at: string;
  total_price: string;
  currency: string;
  financial_status?: string | null;
  test?: boolean;
  total_discounts?: string;
  customer?: {
    first_name?: string;
    last_name?: string;
  };
  line_items: LineItem[];
  shipping_address?: {
    country?: string;
    country_code?: string;
  };
  shipping_lines: any[];
}

function mapCountryToRegion(country?: string | null): string | null {
  const region = shippingCountry(country);
  return region === "US" ? "USA" : region === "CA" ? "CANADA" : region;
}

function inferShippingType(order: ShopifyOrder): string {
  const lines = order.shipping_lines || [];
  if (!lines.length) return "free";
  const title = (lines[0].title || "").toString().toLowerCase();
  if (
    title.includes("express") ||
    title.includes("expedited") ||
    title.includes("priority")
  ) {
    return "express";
  }
  return "free";
}

function getItemConfigKey(item: LineItem): string | null {
  if (item.variant_id != null && item.variant_id !== undefined) {
    return String(item.variant_id);
  }
  if (item.product_id != null && item.product_id !== undefined) {
    return String(item.product_id);
  }
  const title = item.title || item.name;
  if (title) {
    return title.toString();
  }
  return null;
}

export function computeCogsForLineItem(item: LineItem, cogsConfig: CogsConfigMap): number {
  if (!item) return 0;
  const quantity = item.quantity || 0;
  if (!quantity) return 0;

  const key = getItemConfigKey(item);
  if (!key) return 0;

  const perItem = cogsConfig[key];
  if (!perItem || isNaN(perItem)) return 0;

  return perItem * quantity;
}

export function computeShippingForLineItem(
  item: LineItem,
  region: string | null,
  shippingType: string,
  shippingConfig: ShippingConfigMap,
  exchangeRate: number = 1.0
): number {
  if (!item) return 0;
  return shippingPrice(item, region, shippingType, shippingConfig, exchangeRate).cost;
}

type ShippingPrice = { cost: number; configured: boolean };

function shippingPrice(
  item: LineItem, region: string | null, shippingType: string,
  shippingConfig: ShippingConfigMap, exchangeRate: number,
): ShippingPrice {
  if (item.requires_shipping === false || item.quantity <= 0) return { cost: 0, configured: true };
  const key = getItemConfigKey(item);
  const config = key ? shippingConfig[key] : undefined;
  if (!region || !config) return { cost: 0, configured: false };
  const country = region === "USA" ? "US" : region === "CANADA" ? "CA" : region;
  const rates = config.rates ?? config;
  // Existing three-region profiles previously used EU prices for these destinations.
  const countryRates = rates[country] ?? (["UK", "AU", "NZ"].includes(country) ? rates.EU : undefined);
  const prices = countryRates?.[shippingType === "express" ? "Express" : "Standard"];
  if (!prices) return { cost: 0, configured: false };
  const tiers = Object.keys(prices).map(Number).filter(n => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
  if (!tiers.length) return { cost: 0, configured: false };
  if (!Number.isInteger(item.quantity)) throw new Error("Invalid shipping quantity");
  const quantities: number[] = [];
  if (item.quantity <= tiers[tiers.length - 1]) quantities.push(item.quantity);
  else {
    // Preserve the existing largest-tier decomposition for orders above the table range.
    let remaining = item.quantity;
    while (remaining > 0) {
      const tier = [...tiers].reverse().find(n => n <= remaining);
      if (!tier) return { cost: 0, configured: false };
      quantities.push(tier);
      remaining -= tier;
    }
  }
  let cost = 0;
  for (const quantity of quantities) {
    const value = prices[String(quantity)];
    if (value === undefined || value === null || value === "") return { cost: 0, configured: false };
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) throw new Error("Invalid configured shipping cost");
    cost += amount;
  }
  const currency = (config.currency ?? "USD").toUpperCase();
  if (currency === "EUR") {
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) throw new Error("Invalid EUR/USD rate");
    cost *= exchangeRate;
  } else if (currency !== "USD") throw new Error(`Unsupported shipping cost currency: ${currency}`);
  return { cost, configured: true };
}

export function computeShippingForOrderItems(
  items: LineItem[], region: string | null, shippingType: string,
  shippingConfig: ShippingConfigMap, exchangeRate: number = 1,
): ShippingPrice[] {
  const result = items.map(() => ({ cost: 0, configured: true }));
  const groups = new Map<string, number[]>();
  items.forEach((item, index) => {
    if (item.requires_shipping === false || item.quantity <= 0) return;
    const key = getItemConfigKey(item);
    const profileId = key ? shippingConfig[key]?.profileId : undefined;
    // Direct variant configs retain their existing per-line behavior.
    const group = profileId == null ? `line:${index}` : `profile:${profileId}`;
    groups.set(group, [...(groups.get(group) ?? []), index]);
  });
  for (const indexes of Array.from(groups.values())) {
    const quantity = indexes.reduce((sum, index) => sum + items[index].quantity, 0);
    const price = shippingPrice({ ...items[indexes[0]], quantity }, region, shippingType, shippingConfig, exchangeRate);
    let allocated = 0;
    indexes.forEach((index, position) => {
      const cost = position === indexes.length - 1 ? price.cost - allocated : price.cost * items[index].quantity / quantity;
      result[index] = { cost, configured: price.configured };
      allocated += cost;
    });
  }
  return result;
}

interface EnrichedLineItem extends LineItem {
  price: number;
  cogs: number;
  shippingCost: number;
  shippingCostConfigured: boolean;
}

export interface ProcessedOrder {
  id: string;
  orderNumber: number;
  createdAt: string;
  customer: string;
  total: number;
  currency: string;
  discount: number;
  tip: number;
  shippingRevenue: number;
  country: string | null;
  cogs: number;
  shippingCost: number;
  processingFees: number;
  processingFeeSource: "shopify" | "estimated";
  profit: number; // Added: total - cogs - shippingCost - processingFees
  shippingType: string;
  region: string | null;
  items: EnrichedLineItem[];
}

export function processOrders(
  orders: ShopifyOrder[],
  cogsConfig: CogsConfigMap,
  shippingConfig: ShippingConfigMap,
  exchangeRate: number = 1.0,
  orderFees?: Map<number, number>, // order_id -> posted Shopify Payments charge fees
  percentFee = 0.028,
  fixedFee = 0.29
): {
  revenue: number;
  ordersCount: number;
  totalCogs: number;
  totalShipping: number;
  processedOrders: ProcessedOrder[];
} {
  let revenue = 0;
  let totalCogs = 0;
  let totalShipping = 0;
  const processedOrders: ProcessedOrder[] = [];

  for (const order of orders) {
    // An authorization or uncollected order is not a completed sale. Keep an
    // originally paid/refunded order's gross sale, then book its actual refund
    // once on the ledger processing date.
    if (order.test || ["pending", "authorized", "voided"].includes(order.financial_status || "")) continue;
    if (order.financial_status === "partially_paid") {
      throw new Error("Partially paid Shopify orders need captured-payment accounting before profit can be verified");
    }
    if (!["paid", "partially_refunded", "refunded"].includes(order.financial_status || "")) {
      throw new Error(`Shopify order has an unsupported payment status: ${order.financial_status ?? "missing"}`);
    }
    if (order.currency !== "USD") throw new Error(`Unsupported order currency: ${order.currency}`);
    const val = Number(order.total_price);
    if (!Number.isFinite(val) || val < 0) throw new Error("Shopify order has an invalid total price");
    revenue += val;

    const shippingCountry = order.shipping_address?.country || null;
    const customerName =
      order.customer
        ? [order.customer.first_name, order.customer.last_name].filter(Boolean).join(" ")
        : "Guest";

    const region = mapCountryToRegion(order.shipping_address?.country_code || shippingCountry);
    const shippingType = inferShippingType(order);

    let orderCogs = 0;
    let orderShipping = 0;

    const lineItems = order.line_items || [];
    const shippingPrices = computeShippingForOrderItems(lineItems, region, shippingType, shippingConfig, exchangeRate);
    const enrichedLineItems: EnrichedLineItem[] = [];
    
    for (let index = 0; index < lineItems.length; index++) {
      const item = lineItems[index];
      const itemCogs = computeCogsForLineItem(item, cogsConfig);
      const itemShipping = shippingPrices[index].cost;
      
      orderCogs += itemCogs;
      orderShipping += itemShipping;
      
      // Create enriched line item with calculated values
      const itemPrice = parseFloat(String(item.price || "0"));
      enrichedLineItems.push({
        ...item,
        price: itemPrice,
        cogs: itemCogs,
        shippingCost: itemShipping,
        shippingCostConfigured: shippingPrices[index].configured,
      });
    }

    totalCogs += orderCogs;
    totalShipping += orderShipping;

    const discountValue = order.total_discounts ? parseFloat(order.total_discounts) : 0;
    
    // Extract tip (what customer paid as tip)
    const tipValue = (order as any).total_tip_received ? parseFloat((order as any).total_tip_received) : 0;
    
    // Extract shipping revenue (what customer paid for shipping)
    let shippingRevenue = 0;
    if (order.shipping_lines && order.shipping_lines.length > 0) {
      for (const shippingLine of order.shipping_lines) {
        const price = parseFloat(String(shippingLine.price || "0"));
        if (!isNaN(price)) {
          shippingRevenue += price;
        }
      }
    }
    
    const orderIdNum = Number(order.id);
    const actualFee = orderFees?.get(orderIdNum);
    const processingFeeSource = actualFee !== undefined ? "shopify" : "estimated";
    const orderProcessingFees = actualFee ?? val * percentFee + fixedFee;
    
    // Calculate profit for this order
    const orderProfit = val - orderCogs - orderShipping - orderProcessingFees;
    
    processedOrders.push({
      id: "#" + (order.order_number || order.id),
      orderNumber: order.order_number,
      createdAt: order.created_at,
      customer: customerName,
      total: val,
      currency: order.currency || "USD",
      discount: discountValue,
      tip: tipValue,
      shippingRevenue,
      country: shippingCountry || null,
      cogs: orderCogs,
      shippingCost: orderShipping,
      processingFees: orderProcessingFees,
      processingFeeSource,
      profit: orderProfit,
      shippingType,
      region,
      items: enrichedLineItems,
    });
  }

  return {
    revenue,
    ordersCount: processedOrders.length,
    totalCogs,
    totalShipping,
    processedOrders,
  };
}

export function calculateProcessingFees(
  revenue: number,
  ordersCount: number,
  percentFee: number = 0.028,
  fixedFee: number = 0.29
): number {
  return revenue * percentFee + ordersCount * fixedFee;
}

function anchoredCalendarOccurrence(start: Date, monthsSinceStart: number): Date {
  const firstOfMonth = new Date(Date.UTC(
    start.getUTCFullYear(), start.getUTCMonth() + monthsSinceStart, 1,
    start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(), start.getUTCMilliseconds()
  ));
  const lastDay = new Date(Date.UTC(
    firstOfMonth.getUTCFullYear(), firstOfMonth.getUTCMonth() + 1, 0
  )).getUTCDate();
  firstOfMonth.setUTCDate(Math.min(start.getUTCDate(), lastDay));
  return firstOfMonth;
}

/**
 * Calculate operational expenses for a given period
 * Counts discrete occurrences of recurring expenses (not prorated)
 * 
 * Logic:
 * - One-time: Count once if date falls in range
 * - Monthly: Count once for each month where the expense is active
 * - Yearly: Count once for each year where the expense is active
 * - Respects endDate for "No Longer Active" expenses
 */
export function calculateOperationalExpensesForPeriod(
  expenses: Array<{
    type: "one_time" | "monthly" | "yearly";
    amount: number;
    date?: Date | null;
    startDate?: Date | null;
    endDate?: Date | null;
  }>,
  fromDate: Date,
  toDate: Date
): number {
  let total = 0;

  for (const expense of expenses) {
    if (expense.type === "one_time") {
      // One-time expense: count once if date falls in range
      if (expense.date) {
        const expenseDate = new Date(expense.date);
        if (expenseDate >= fromDate && expenseDate <= toDate) {
          total += expense.amount;
        }
      }
    } else if (expense.type === "monthly") {
      // Monthly recurring: count once for each occurrence in range
      if (!expense.startDate) continue;

      const start = new Date(expense.startDate);
      const end = expense.endDate ? new Date(expense.endDate) : new Date("2099-12-31"); // Far future if no end date

      // Anchor on the original day: Jan 31 -> Feb 28 -> Mar 31.
      for (let month = 0; month < 12000; month++) {
        const currentDate = anchoredCalendarOccurrence(start, month);
        if (currentDate > end || currentDate > toDate) break;
        if (currentDate >= fromDate && currentDate <= toDate) {
          total += expense.amount;
        }
      }
    } else if (expense.type === "yearly") {
      // Yearly recurring: count once for each occurrence in range
      if (!expense.startDate) continue;

      const start = new Date(expense.startDate);
      const end = expense.endDate ? new Date(expense.endDate) : new Date("2099-12-31"); // Far future if no end date

      for (let year = 0; year < 1000; year++) {
        const currentDate = anchoredCalendarOccurrence(start, year * 12);
        if (currentDate > end || currentDate > toDate) break;
        if (currentDate >= fromDate && currentDate <= toDate) {
          total += expense.amount;
        }
      }
    }
  }

  return total;
}
