import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchShopifyBalanceTransactions, fetchShopifyDisputes, fetchShopifyOrders,
  summarizeBalanceTransactions, type BalanceTransaction,
} from "./shopify-data";

const range = { fromDate: "2026-10-01", toDate: "2026-10-02" };
const originalFetch = globalThis.fetch;
afterEach(() => { vi.stubGlobal("fetch", originalFetch); });
function reply(data: object, next?: string, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status, headers: next ? { Link: `<${next}>; rel="next"` } : {},
  });
}
function row(partial: Partial<BalanceTransaction> = {}): BalanceTransaction {
  return {
    id: 1, type: "charge", amount: "100.00", fee: "2.90", net: "97.10",
    currency: "USD", processed_at: "2026-10-01T12:00:00Z", source_order_id: 42,
    ...partial,
  };
}

describe("Shopify dispute API", () => {
  it("uses documented request parameters and groups actual case status by original currency", async () => {
    const mock = vi.fn(async (input: string) => {
      const url = new URL(input);
      expect(url.searchParams.has("initiated_at_min")).toBe(false);
      expect(url.searchParams.has("initiated_at_max")).toBe(false);
      expect(url.searchParams.has("fields")).toBe(false);
      if (url.searchParams.has("page_info")) return reply({ disputes: [
        { id: 5, initiated_at: "2026-09-30T12:00:00Z", amount: "999", currency: "USD", status: "lost", type: "chargeback" },
      ] });
      return reply({ disputes: [
        { id: 1, initiated_at: "2026-10-02T06:00:00Z", amount: "100.00", currency: "USD", status: "won", type: "chargeback" },
        { id: 2, initiated_at: "2026-10-01T06:00:00Z", amount: "40.00", currency: "EUR", status: "lost", type: "chargeback" },
        { id: 3, initiated_at: "2026-10-01T06:00:00Z", amount: "5.00", currency: "USD", status: "accepted", type: "chargeback" },
        { id: 4, initiated_at: "2026-10-01T06:00:00Z", amount: "12.00", currency: "USD", status: "needs_response", type: "inquiry" },
      ] }, "https://test.myshopify.com/admin/api/2026-07/shopify_payments/disputes.json?page_info=opaque&limit=250");
    });
    vi.stubGlobal("fetch", mock);
    const result = await fetchShopifyDisputes("test.myshopify.com", "token", range, -300, "2026-07", "America/New_York");
    expect(result).toMatchObject({ count: 4, wonCount: 1, lostCount: 1, acceptedCount: 1, pendingCount: 1 });
    expect(result.amountsByCurrency).toEqual({ USD: { won: 100, accepted: 5, needs_response: 12 }, EUR: { lost: 40 } });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("never converts an unavailable dispute API into a fictitious zero", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: "denied" }, undefined, 403)));
    await expect(fetchShopifyDisputes("test.myshopify.com", "token", range)).rejects.toThrow("HTTP 403");
  });
});

describe("Shopify Payments ledger", () => {
  it("classifies fees and principal by signed posted entries rather than current dispute status", () => {
    const result = summarizeBalanceTransactions([
      row(),
      row({ id: 2, type: "refund", amount: "-20.00", fee: "0.00", net: "-20.00" }),
      row({ id: 3, type: "dispute", amount: "-100.00", fee: "15.00", net: "-115.00", source_order_id: 42 }),
      row({ id: 4, type: "dispute", amount: "100.00", fee: "-15.00", net: "115.00", source_order_id: 42 }),
      row({ id: 5, type: "dispute", amount: "-35.00", fee: "7.00", net: "-42.00", source_order_id: 43 }),
      row({ id: 6, type: "dispute", amount: "10.00", fee: "0.00", net: "10.00", source_order_id: 43 }),
    ], 1.2);
    expect(result.orderFees).toEqual(new Map([[42, 2.9]]));
    expect(result.totalRefunds).toBe(20);
    expect(result.totalDisputeValue).toBe(135);
    expect(result.totalDisputeRecovered).toBe(110);
    expect(result.totalDisputeFees).toBe(22);
    expect(result.totalDisputeFeesRecovered).toBe(15); // no automatic recovery on the partial win
    expect(result.unclassifiedTypes).toEqual([]);
  });

  it("separates standalone dispute fees and held funds from operating profit", () => {
    const result = summarizeBalanceTransactions([
      row({ id: 1, type: "chargeback_fee", amount: "-8.00", fee: "0", net: "-8.00" }),
      row({ id: 2, type: "chargeback_fee_refund", amount: "8.00", fee: "0", net: "8.00" }),
      row({ id: 3, type: "chargeback_hold", amount: "-100", fee: "0", net: "-100" }),
      row({ id: 4, type: "chargeback_hold_release", amount: "100", fee: "0", net: "100" }),
      row({ id: 5, type: "refund", amount: "-20", fee: "-0.20", net: "-19.80" }),
    ], 1.2);
    expect(result.totalDisputeValue).toBe(0);
    expect(result.totalDisputeFees).toBe(8);
    expect(result.totalDisputeFeesRecovered).toBe(8);
    expect(result.totalRefunds).toBe(20);
    expect(result.refundFeeAdjustments).toBe(-0.2);
    expect(result.holdMovement).toBe(0);
    expect(result.orderFees.size).toBe(0);
  });

  it("rejects malformed fee rows and unsupported currencies rather than returning a wrong USD total", () => {
    expect(() => summarizeBalanceTransactions([row({ fee: "bad" })], 1.2)).toThrow("fee");
    expect(() => summarizeBalanceTransactions([row({ currency: "GBP" })], 1.2)).toThrow("GBP");
    expect(() => summarizeBalanceTransactions([row({ type: "dispute", amount: "-100", fee: "15", net: "-100" })], 1.2)).toThrow("reconcile");
  });

  it("shows unclassified fee adjustments as signed unreconciled ledger movement", () => {
    const result = summarizeBalanceTransactions([
      row({ id: 1, type: "charge_adjustment", amount: "-5.00", fee: "0", net: "-5.00" }),
      row({ id: 2, type: "protection_credit", amount: "2.00", fee: "0", net: "2.00" }),
    ], 1.2);
    expect(result.unclassifiedTypes).toEqual(["charge_adjustment", "protection_credit"]);
    expect(result.unclassifiedSignedNet).toBe(-3);
    expect(result.unclassifiedCount).toBe(2);
    expect(result.orderFees.size).toBe(0);
  });

  it("does not silently truncate at ten pages and follows the exact Shopify cursor", async () => {
    const mock = vi.fn(async (input: string) => {
      const url = new URL(input);
      const page = Number(url.searchParams.get("page_info") ?? "0");
      const next = page < 10 ? `https://test.myshopify.com/admin/api/2026-07/shopify_payments/balance/transactions.json?page_info=${page + 1}&limit=250` : undefined;
      return reply({ transactions: [row({ id: page + 1, source_order_id: 1000 + page })] }, next);
    });
    vi.stubGlobal("fetch", mock);
    const result = await fetchShopifyBalanceTransactions("test.myshopify.com", "token", range);
    expect(result.pageCount).toBe(11);
    expect(result.orderFees.size).toBe(11);
    expect(mock).toHaveBeenCalledTimes(11);
  });

  it("stops at the first older page and rejects missing payout access", async () => {
    const mock = vi.fn(async () => reply({ transactions: [row({ processed_at: "2026-09-01T12:00:00Z" })] }, "https://test.myshopify.com/admin/api/2026-07/shopify_payments/balance/transactions.json?page_info=next"));
    vi.stubGlobal("fetch", mock);
    const result = await fetchShopifyBalanceTransactions("test.myshopify.com", "token", range);
    expect(result.orderFees.size).toBe(0);
    expect(mock).toHaveBeenCalledTimes(1);
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: "forbidden" }, undefined, 403)));
    await expect(fetchShopifyBalanceTransactions("test.myshopify.com", "token", range)).rejects.toThrow("payout access");
  });
});

describe("Shopify orders", () => {
  it("applies a DST-aware range and excludes the next day's midnight", async () => {
    const mock = vi.fn(async (input: string) => {
      const url = new URL(input);
      expect(url.searchParams.get("created_at_min")).toBe("2026-03-08T05:00:00.000Z");
      expect(url.searchParams.get("created_at_max")).toBe("2026-03-09T04:00:00.000Z");
      return reply({ orders: [
        { id: "1", order_number: 1, created_at: "2026-03-09T03:59:59.999Z", total_price: "10", currency: "USD", line_items: [], shipping_lines: [] },
        { id: "2", order_number: 2, created_at: "2026-03-09T04:00:00Z", total_price: "10", currency: "USD", line_items: [], shipping_lines: [] },
      ] });
    });
    vi.stubGlobal("fetch", mock);
    const orders = await fetchShopifyOrders("test.myshopify.com", "token", { fromDate: "2026-03-08", toDate: "2026-03-08" }, -300, "2026-07", "America/New_York");
    expect(orders.map(order => order.id)).toEqual(["1"]);
  });
});
