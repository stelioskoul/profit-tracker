import { describe, expect, it } from "vitest";
import { isInShopifyDateRange, referenceUtcOffsetMinutes, shopifyDateBounds } from "./shopify-date";

const day = { fromDate: "2026-03-08", toDate: "2026-03-08" };

describe("Shopify store-local reporting days", () => {
  it("uses the actual 23-hour New York spring-forward day", () => {
    const bounds = shopifyDateBounds(day, -300, "America/New_York");
    expect(new Date(bounds.start).toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(new Date(bounds.end).toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect(isInShopifyDateRange("2026-03-09T03:59:59.999Z", day, -300, "America/New_York")).toBe(true);
    expect(isInShopifyDateRange("2026-03-09T04:00:00Z", day, -300, "America/New_York")).toBe(false);
  });

  it("uses the actual 25-hour New York fall-back day", () => {
    const bounds = shopifyDateBounds(
      { fromDate: "2026-11-01", toDate: "2026-11-01" }, -300, "America/New_York");
    expect(new Date(bounds.start).toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(new Date(bounds.end).toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("preserves a fixed-offset fallback for a store without an IANA timezone", () => {
    const bounds = shopifyDateBounds(day, -300);
    expect(new Date(bounds.end - bounds.start).getUTCHours()).toBe(0);
    expect(bounds.end - bounds.start).toBe(24 * 60 * 60 * 1000);
  });

  it("changes order and processed-at day membership when the store IANA timezone changes", () => {
    const period = { fromDate: "2026-10-02", toDate: "2026-10-02" };
    expect(new Date(shopifyDateBounds(period, -300, "America/New_York").start).toISOString())
      .toBe("2026-10-02T04:00:00.000Z");
    expect(new Date(shopifyDateBounds(period, 120, "Europe/Athens").start).toISOString())
      .toBe("2026-10-01T21:00:00.000Z");
    expect(isInShopifyDateRange("2026-10-01T23:00:00Z", period, 120, "Europe/Athens")).toBe(true);
    expect(isInShopifyDateRange("2026-10-01T23:00:00Z", period, -300, "America/New_York")).toBe(false);
    expect(new Date(shopifyDateBounds(period, 330, "Asia/Kolkata").start).toISOString())
      .toBe("2026-10-01T18:30:00.000Z");
    expect(referenceUtcOffsetMinutes("Europe/Athens", 2026)).toBe(120);
    expect(referenceUtcOffsetMinutes("America/New_York", 2026)).toBe(-300);
    expect(referenceUtcOffsetMinutes("Asia/Kolkata", 2026)).toBe(330);
  });

  it("rejects impossible and reversed dates rather than silently returning zero", () => {
    expect(() => shopifyDateBounds({ fromDate: "2026-02-30", toDate: "2026-03-01" })).toThrow();
    expect(() => shopifyDateBounds({ fromDate: "2026-10-03", toDate: "2026-10-02" })).toThrow();
  });
});
