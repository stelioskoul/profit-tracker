import { describe, expect, it } from "vitest";
import { processOrders } from "./profit-calculator";

const makeOrder = (status: string | undefined, test = false) => ({
  id: "42", order_number: 42, created_at: "2026-10-02T12:00:00Z",
  total_price: "100.00", currency: "USD", financial_status: status,
  test, line_items: [{ variant_id: 1, quantity: 1, price: "100" }],
  shipping_address: { country: "US" }, shipping_lines: [],
});

const costs = { "1": 20 };

describe("paid order gross-sales basis", () => {
  it("excludes authorized and test orders and preserves an actual zero Shopify fee", () => {
    const result = processOrders([
      makeOrder("paid"), makeOrder("authorized"), makeOrder("paid", true),
    ], costs, {}, 1, new Map([[42, 0]]));
    expect(result.ordersCount).toBe(1);
    expect(result.revenue).toBe(100);
    expect(result.totalCogs).toBe(20);
    expect(result.processedOrders[0].processingFees).toBe(0);
    expect(result.processedOrders[0].processingFeeSource).toBe("shopify");
  });

  it("marks missing charge-fee data as an estimate using configured, not hard-coded fees", () => {
    const result = processOrders([makeOrder("paid")], costs, {}, 1, new Map(), 0.01, 0.10);
    expect(result.processedOrders[0].processingFees).toBe(1.1);
    expect(result.processedOrders[0].processingFeeSource).toBe("estimated");
  });

  it("rejects partially paid, unknown-state, invalid-price and non-USD orders", () => {
    expect(() => processOrders([makeOrder("partially_paid")], costs, {})).toThrow("Partially paid");
    expect(() => processOrders([makeOrder(undefined)], costs, {})).toThrow("missing");
    expect(() => processOrders([{ ...makeOrder("paid"), total_price: "invalid" }], costs, {})).toThrow("invalid total");
    expect(() => processOrders([{ ...makeOrder("paid"), currency: "GBP" }], costs, {})).toThrow("GBP");
  });
});
