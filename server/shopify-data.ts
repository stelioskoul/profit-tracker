import { shopifyDateBounds, type ShopifyDateRange } from "./shopify-date";

interface ShopifyOrder {
  id: string;
  order_number: number;
  created_at: string;
  total_price: string;
  currency: string;
  financial_status?: string | null;
  test?: boolean;
  cancelled_at?: string | null;
  fulfillment_status?: string | null;
  customer?: { first_name?: string; last_name?: string };
  line_items: any[];
  shipping_address?: { country?: string };
  shipping_lines: any[];
}

/** page_info is opaque: use Shopify's supplied Link URL, never reconstruct it. */
function nextShopifyPage(link: string | null, originalUrl: URL): URL | null {
  const next = link?.split(",").find(part => /;\s*rel="?next"?/i.test(part));
  const match = next?.match(/<([^>]+)>/);
  if (!match) return null;
  const url = new URL(match[1]);
  if (url.origin !== originalUrl.origin || url.pathname !== originalUrl.pathname ||
      !url.searchParams.has("page_info")) {
    throw new Error("Shopify returned an invalid pagination link");
  }
  return url;
}

async function shopifyList<T>(
  original: URL,
  accessToken: string,
  resource: "orders" | "disputes",
  accept: (item: T) => boolean
): Promise<T[]> {
  let url: URL | null = original;
  const visited = new Set<string>();
  const result: T[] = [];
  while (url) {
    if (visited.has(url.toString())) throw new Error(`Shopify ${resource} pagination repeated a cursor`);
    visited.add(url.toString());
    const response = await fetch(url.toString(), { headers: { "X-Shopify-Access-Token": accessToken } });
    if (!response.ok) throw new Error(`Shopify ${resource} API returned HTTP ${response.status}; verify store access and scopes`);
    const items = (await response.json())[resource];
    if (!Array.isArray(items)) throw new Error(`Shopify ${resource} response is incomplete`);
    result.push(...items.filter(accept));
    url = nextShopifyPage(response.headers.get("Link"), original);
  }
  return result;
}

export async function fetchShopifyOrders(
  shopDomain: string,
  accessToken: string,
  dateRange: ShopifyDateRange,
  timezoneOffset = -300,
  apiVersion = "2026-07",
  timeZone?: string | null
): Promise<ShopifyOrder[]> {
  const { start, end } = shopifyDateBounds(dateRange, timezoneOffset, timeZone);
  const url = new URL(`https://${shopDomain}/admin/api/${apiVersion}/orders.json`);
  url.searchParams.set("limit", "250");
  url.searchParams.set("status", "any");
  url.searchParams.set("created_at_min", new Date(start).toISOString());
  // Shopify's upper bound is inclusive: fetch next midnight, then exclude it locally.
  url.searchParams.set("created_at_max", new Date(end).toISOString());
  url.searchParams.set("fields", "id,order_number,created_at,total_price,currency,customer,line_items,shipping_address,shipping_lines,total_discounts,total_tip_received,financial_status,test,cancelled_at,fulfillment_status");
  return shopifyList<ShopifyOrder>(url, accessToken, "orders", order => {
    const created = Date.parse(order.created_at);
    if (!Number.isFinite(created)) throw new Error("Shopify returned an order without a valid date");
    return created >= start && created < end;
  });
}

export type DisputeStatus = "won" | "lost" | "accepted" | "charge_refunded" |
  "needs_response" | "under_review" | "prevented";
export interface DisputeSummary {
  count: number;
  wonCount: number;
  lostCount: number;
  acceptedCount: number;
  refundedCount: number;
  pendingCount: number;
  preventedCount: number;
  /** Disputed face value is case metadata, not actual money debited or recovered. */
  amountsByCurrency: Record<string, Partial<Record<DisputeStatus, number>>>;
}
interface ShopifyDispute {
  id: number;
  initiated_at: string;
  amount: string;
  currency: string;
  status: string;
  type: string;
}

export async function fetchShopifyDisputes(
  shopDomain: string,
  accessToken: string,
  dateRange: ShopifyDateRange,
  timezoneOffset = -300,
  apiVersion = "2026-07",
  timeZone?: string | null
): Promise<DisputeSummary> {
  const { start, end } = shopifyDateBounds(dateRange, timezoneOffset, timeZone);
  const url = new URL(`https://${shopDomain}/admin/api/${apiVersion}/shopify_payments/disputes.json`);
  // REST documents a single initiated_at date but no initiated_at_min/max.
  // Traverse all cursor pages because this resource's sort order is not guaranteed.
  url.searchParams.set("limit", "250");
  const list = await shopifyList<ShopifyDispute>(url, accessToken, "disputes", dispute => {
    const initiated = Date.parse(dispute.initiated_at);
    if (!Number.isFinite(initiated)) throw new Error("Shopify dispute is missing initiated_at");
    return initiated >= start && initiated < end;
  });
  const summary: DisputeSummary = {
    count: 0, wonCount: 0, lostCount: 0, acceptedCount: 0,
    refundedCount: 0, pendingCount: 0, preventedCount: 0, amountsByCurrency: {},
  };
  const seen = new Set<number>();
  for (const dispute of list) {
    const id = Number(dispute.id);
    if (!Number.isSafeInteger(id)) throw new Error("Shopify dispute is missing a valid ID");
    if (seen.has(id)) continue;
    seen.add(id);
    const amount = Number(dispute.amount);
    const currency = dispute.currency?.toUpperCase();
    if (!Number.isFinite(amount) || amount < 0 || !/^[A-Z]{3}$/.test(currency ?? "")) {
      throw new Error("Shopify dispute has an invalid amount or currency");
    }
    const status = dispute.status?.toLowerCase() as DisputeStatus;
    if (!["won", "lost", "accepted", "charge_refunded", "needs_response", "under_review", "prevented"].includes(status)) {
      throw new Error(`Unrecognized Shopify dispute status: ${String(dispute.status)}`);
    }
    summary.count++;
    if (status === "won") summary.wonCount++;
    if (status === "lost") summary.lostCount++;
    if (status === "accepted") summary.acceptedCount++;
    if (status === "charge_refunded") summary.refundedCount++;
    if (status === "prevented") summary.preventedCount++;
    if (status === "needs_response" || status === "under_review") summary.pendingCount++;
    const amounts = (summary.amountsByCurrency[currency] ??= {});
    amounts[status] = (amounts[status] ?? 0) + amount;
  }
  return summary;
}

export interface BalanceTransaction {
  id: number;
  type: string;
  amount: string;
  fee: string;
  net: string;
  source_id?: number | null;
  source_order_id?: number | null;
  source_order_transaction_id?: number | null;
  source_type?: string | null;
  currency: string;
  processed_at: string;
  test?: boolean;
}
export interface BalanceSummary {
  orderFees: Map<number, number>;
  /** All Shopify Payments charge fees posted in this period. */
  chargeFeesTotal: number;
  /** Dispute principal debited, including unresolved chargebacks. */
  totalDisputeValue: number;
  totalDisputeFees: number;
  /** Principal credited, not necessarily every case currently marked won. */
  totalDisputeRecovered: number;
  totalDisputeFeesRecovered: number;
  /** Signed refund principal (credits/reversals reduce this number). */
  totalRefunds: number;
  refundFeeAdjustments: number;
  pageCount: number;
  fxApproximate: boolean;
  unclassifiedTypes: string[];
  unclassifiedSignedNet: number;
  unclassifiedCount: number;
  holdMovement: number;
}

function money(value: string | number | undefined, label: string): number {
  if (value == null || String(value).trim() === "" || !Number.isFinite(Number(value))) {
    throw new Error(`Shopify balance row has an invalid ${label}`);
  }
  return Number(value);
}
function usd(amount: number, currency: string, eurToUsdRate: number): number {
  if (currency === "USD") return amount;
  if (currency === "EUR" && Number.isFinite(eurToUsdRate) && eurToUsdRate > 0) {
    return Math.round(amount * eurToUsdRate * 100) / 100;
  }
  throw new Error(`Unsupported Shopify payout currency ${currency}; cannot safely add it as USD`);
}

/** Classify actual signed ledger postings; dispute case status never posts money. */
export function summarizeBalanceTransactions(
  transactions: BalanceTransaction[],
  eurToUsdRate: number
): Omit<BalanceSummary, "pageCount"> {
  const totals: Omit<BalanceSummary, "pageCount"> = {
    orderFees: new Map(), chargeFeesTotal: 0, totalDisputeValue: 0, totalDisputeFees: 0,
    totalDisputeRecovered: 0, totalDisputeFeesRecovered: 0,
    totalRefunds: 0, refundFeeAdjustments: 0, fxApproximate: false,
    unclassifiedTypes: [], unclassifiedSignedNet: 0, unclassifiedCount: 0,
    holdMovement: 0,
  };
  const seen = new Set<number>();
  const unknown = new Set<string>();
  for (const row of transactions) {
    const id = Number(row.id);
    if (!Number.isSafeInteger(id)) throw new Error("Shopify balance row has an invalid ID");
    if (seen.has(id)) continue;
    seen.add(id);
    if (row.test) continue;
    const currency = row.currency?.toUpperCase();
    const amount = money(row.amount, "amount");
    const fee = money(row.fee, "fee");
    const net = money(row.net, "net");
    const value = usd(amount, currency, eurToUsdRate);
    const feeUsd = usd(fee, currency, eurToUsdRate);
    const netUsd = usd(net, currency, eurToUsdRate);
    if (currency === "EUR") totals.fxApproximate = true;
    const type = String(row.type || "").toLowerCase().replace(/\s+/g, "_");
    const source = String(row.source_type || "").toLowerCase();
    const standaloneFee = type === "chargeback_fee" || type === "chargeback_fee_refund";
    const hold = type === "chargeback_hold" || type === "chargeback_hold_release" ||
      type === "reserve" || type.startsWith("reserved_funds") ||
      type === "risk_withdrawal" || type === "risk_reversal";
    const dispute = type === "dispute" || type === "chargeback" ||
      type === "dispute_withdrawal" || type === "dispute_reversal" ||
      type === "chargeback_reversal" || type === "chargeback_won" ||
      (type === "adjustment" && source.includes("dispute"));
    if (hold) {
      totals.holdMovement += netUsd;
    } else if (standaloneFee) {
      // A standalone fee row's net is the fee debit or refund; its fee field
      // may be zero because the fee is represented as gross amount instead.
      if (netUsd < 0) totals.totalDisputeFees -= netUsd;
      else totals.totalDisputeFeesRecovered += netUsd;
    } else if (dispute) {
      if (Math.abs(amount - fee - net) > 0.02) {
        throw new Error("Shopify dispute balance row did not reconcile: net differs from amount minus fee");
      }
      if (value < 0) totals.totalDisputeValue -= value;
      else totals.totalDisputeRecovered += value;
      if (feeUsd > 0) totals.totalDisputeFees += feeUsd;
      else totals.totalDisputeFeesRecovered -= feeUsd;
    } else if (type === "refund" || type === "refund_adjustment" || type === "refund_failure") {
      totals.totalRefunds -= value;
      totals.refundFeeAdjustments += feeUsd;
    } else if (type === "charge") {
      totals.chargeFeesTotal += feeUsd;
      const orderId = Number(row.source_order_id);
      if (Number.isSafeInteger(orderId) && orderId > 0) {
        totals.orderFees.set(orderId, (totals.orderFees.get(orderId) ?? 0) + feeUsd);
      } else if (feeUsd !== 0) {
        unknown.add("charge_without_order");
      }
    } else if (type === "payout" || type.startsWith("payout_") ||
      type === "transfer" || type.startsWith("transfer_") ||
      type.startsWith("balance_transfer_")) {
      // A payout/transfer moves already recorded money; it isn't new profit.
    } else if (Math.abs(netUsd) > 0.005) {
      unknown.add(type || "missing_type");
      totals.unclassifiedSignedNet += netUsd;
      totals.unclassifiedCount++;
    }
  }
  totals.unclassifiedTypes = Array.from(unknown).sort();
  return totals;
}

export async function fetchShopifyBalanceTransactions(
  shopDomain: string,
  accessToken: string,
  dateRange: ShopifyDateRange,
  apiVersion = "2026-07",
  eurToUsdRate = 1.1665,
  timezoneOffsetMinutes = -300,
  timeZone?: string | null
): Promise<BalanceSummary> {
  const { start, end } = shopifyDateBounds(dateRange, timezoneOffsetMinutes, timeZone);
  const original = new URL(`https://${shopDomain}/admin/api/${apiVersion}/shopify_payments/balance/transactions.json`);
  original.searchParams.set("limit", "250");
  let url: URL | null = original;
  const visited = new Set<string>();
  const rows: BalanceTransaction[] = [];
  let pageCount = 0;
  while (url) {
    if (visited.has(url.toString())) throw new Error("Shopify balance pagination repeated a cursor");
    visited.add(url.toString());
    const response = await fetch(url.toString(), { headers: { "X-Shopify-Access-Token": accessToken } });
    if (!response.ok) {
      if (response.status === 403 || response.status === 404) {
        throw new Error(`Shopify Payments ledger unavailable (HTTP ${response.status}). Reconnect with payout access; refunds and dispute fees cannot be verified.`);
      }
      throw new Error(`Shopify Payments ledger API returned HTTP ${response.status}`);
    }
    pageCount++;
    const page: BalanceTransaction[] = (await response.json()).transactions;
    if (!Array.isArray(page)) throw new Error("Shopify balance response is incomplete");
    let older = false;
    for (const row of page) {
      const processed = Date.parse(row.processed_at);
      if (!Number.isFinite(processed)) throw new Error("Shopify balance row lacks processed_at");
      if (processed >= start && processed < end) rows.push(row);
      if (processed < start) older = true;
    }
    // The ledger is documented newest-first by processed_at. Do not silently
    // cap to ten pages; stop only when older entries have been reached.
    if (older) break;
    url = nextShopifyPage(response.headers.get("Link"), original);
  }
  return { ...summarizeBalanceTransactions(rows, eurToUsdRate), pageCount };
}
