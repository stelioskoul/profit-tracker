import { describe, expect, it } from "vitest";
import { computeShippingForOrderItems, processOrders } from "./profit-calculator";

const rates = {
  US: { Standard: { 1: 10, 2: 17, 3: 24, 10: 65 }, Express: { 1: 12, 2: 20, 3: 30, 10: 76 } },
  EU: { Standard: { 1: 8.5, 2: 13, 10: 48 }, Express: { 1: 10, 2: 16, 10: 65 } },
  CA: { Standard: { 1: 9, 2: 14, 10: 50 }, Express: { 1: 11, 2: 18, 10: 67 } },
  UK: { Standard: { 1: 8.5, 2: 13, 10: 48 }, Express: { 1: 10, 2: 16, 10: 65 } },
  AU: { Standard: { 1: 8.5, 2: 13, 10: 48 }, Express: { 1: 10, 2: 16, 10: 65 } },
  NZ: { Standard: { 1: 8.5, 2: 13, 10: 48 }, Express: { 1: 10, 2: 16, 10: 65 } },
};
const items = [{ variant_id: "car", quantity: 1 }, { variant_id: "bike", quantity: 1 }];
const sameProfile = { car: { ...rates, profileId: 7 }, bike: { ...rates, profileId: 7 } };
const makeOrder = (country_code: string) => ({
  id: "42", order_number: 42, created_at: "2026-10-08T12:00:00Z", total_price: "100", currency: "USD",
  financial_status: "paid", line_items: [{ variant_id: "car", quantity: 1 }],
  shipping_address: { country: "Germany", country_code }, shipping_lines: [],
});

describe("order quantities within an assigned shipping profile", () => {
  it("charges the two-piece rate once for two different products in the same profile", () => {
    expect(computeShippingForOrderItems(items, "USA", "free", sameProfile)).toEqual([
      { cost: 8.5, configured: true }, { cost: 8.5, configured: true },
    ]);
    const order = { ...makeOrder("US"), line_items: items, shipping_lines: [{ title: "Express Shipping" }] };
    const result = processOrders([order], {}, sameProfile);
    expect(result.totalShipping).toBe(20);
    expect(result.processedOrders[0].items.map(item => item.shippingCost)).toEqual([10, 10]);
  });

  it("sums quantities across variants and allocates the total without charging it twice", () => {
    const result = computeShippingForOrderItems([items[0], { ...items[1], quantity: 2 }], "USA", "free", sameProfile);
    expect(result.map(item => item.cost)).toEqual([8, 16]);
  });

  it("keeps separate product profiles and legacy per-line configs independent", () => {
    const separate = { car: { ...rates, profileId: 7 }, bike: { ...rates, profileId: 8 } };
    expect(computeShippingForOrderItems(items, "USA", "free", separate).map(item => item.cost)).toEqual([10, 10]);
    expect(computeShippingForOrderItems(items, "USA", "free", { car: rates, bike: rates }).map(item => item.cost)).toEqual([10, 10]);
  });

  it("excludes non-shippable gift cards from the physical package quantity", () => {
    const result = computeShippingForOrderItems([...items, { variant_id: "gift", quantity: 9, requires_shipping: false }], "USA", "free", sameProfile);
    expect(result.map(item => item.cost)).toEqual([8.5, 8.5, 0]);
    expect(result[2].configured).toBe(true);
  });

  it.each([
    ["US", 65, 76], ["EU", 48, 65], ["CA", 50, 67], ["UK", 48, 65], ["AU", 48, 65], ["NZ", 48, 65],
  ])("uses the ten-piece standard and express rates for %s", (country, standard, express) => {
    const ten = [{ variant_id: "car", quantity: 10 }];
    expect(computeShippingForOrderItems(ten, country as string, "free", sameProfile)[0].cost).toBe(standard);
    expect(computeShippingForOrderItems(ten, country as string, "express", sameProfile)[0].cost).toBe(express);
  });

  it("distinguishes an explicit zero price from an unset method or quantity", () => {
    const config = { car: { US: { Standard: { 1: 0 } }, profileId: 7 } };
    expect(computeShippingForOrderItems([items[0]], "USA", "free", config)[0]).toEqual({ cost: 0, configured: true });
    expect(computeShippingForOrderItems([items[0]], "USA", "express", config)[0]).toEqual({ cost: 0, configured: false });
    expect(computeShippingForOrderItems([{ ...items[0], quantity: 3 }], "USA", "free", { car: { US: { Standard: { 1: 10, 5: 40 } } } })[0].configured).toBe(false);
  });
});

describe("shipping destination selection", () => {
  it.each([["GB", "UK", 11], ["AU", "AU", 22], ["NZ", "NZ", 33]])("uses the explicit %s region rather than EU", (code, region, price) => {
    const config = { car: { ...rates, [region]: { Standard: { 1: price } } } };
    const result = processOrders([makeOrder(code)], {}, config);
    expect(result.processedOrders[0].region).toBe(region);
    expect(result.totalShipping).toBe(price);
  });

  it("flags an unsupported destination instead of silently using EU rates", () => {
    const result = processOrders([makeOrder("JP")], {}, sameProfile);
    expect(result.processedOrders[0].region).toBe(null);
    expect(result.processedOrders[0].items[0].shippingCostConfigured).toBe(false);
  });

  it("retains EU fallback for an existing three-region profile without a UK slot", () => {
    const config = { car: { EU: rates.EU } };
    expect(processOrders([makeOrder("GB")], {}, config).totalShipping).toBe(8.5);
  });
});
