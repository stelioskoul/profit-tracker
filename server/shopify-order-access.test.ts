import { describe, expect, it } from "vitest";
import { assertOrderHistoryAccess } from "./shopify-order-access";

const now = Date.parse("2026-10-02T12:00:00Z");

describe("Shopify 60-day order permissions", () => {
  it("permits recent dates with the standard order scope", () => {
    expect(() => assertOrderHistoryAccess(
      { fromDate: "2026-10-01", toDate: "2026-10-02" },
      "read_orders,read_shopify_payments_payouts", -300, "America/New_York", now
    )).not.toThrow();
  });

  it("rejects an older range without all-orders approval rather than displaying zero revenue", () => {
    expect(() => assertOrderHistoryAccess(
      { fromDate: "2026-07-01", toDate: "2026-07-31" },
      "read_orders,read_shopify_payments_payouts", -300, "America/New_York", now
    )).toThrow("read_all_orders");
  });

  it("permits an older range when read_all_orders was actually granted", () => {
    expect(() => assertOrderHistoryAccess(
      { fromDate: "2026-07-01", toDate: "2026-07-31" },
      "read_orders,read_all_orders", -300, "America/New_York", now
    )).not.toThrow();
  });
});
