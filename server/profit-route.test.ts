import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  getStoreById: vi.fn(),
  getShopifyConnectionByStoreId: vi.fn(),
  getFacebookConnectionsByStoreId: vi.fn(),
  getCogsConfigByStoreId: vi.fn(),
  getShippingConfigByStoreId: vi.fn(),
  getProcessingFeesConfigByStoreId: vi.fn(),
  getOperationalExpensesByStoreId: vi.fn(),
  fetchShopifyOrders: vi.fn(),
  fetchShopifyDisputes: vi.fn(),
  fetchShopifyBalanceTransactions: vi.fn(),
  getEurUsdRate: vi.fn(),
}));
vi.mock("./db", async importOriginal => ({
  ...(await importOriginal<typeof import("./db")>()),
  getStoreById: mocks.getStoreById,
  getShopifyConnectionByStoreId: mocks.getShopifyConnectionByStoreId,
  getFacebookConnectionsByStoreId: mocks.getFacebookConnectionsByStoreId,
  getCogsConfigByStoreId: mocks.getCogsConfigByStoreId,
  getShippingConfigByStoreId: mocks.getShippingConfigByStoreId,
  getProcessingFeesConfigByStoreId: mocks.getProcessingFeesConfigByStoreId,
  getOperationalExpensesByStoreId: mocks.getOperationalExpensesByStoreId,
}));
vi.mock("./shopify-data", async importOriginal => ({
  ...(await importOriginal<typeof import("./shopify-data")>()),
  fetchShopifyOrders: mocks.fetchShopifyOrders,
  fetchShopifyDisputes: mocks.fetchShopifyDisputes,
  fetchShopifyBalanceTransactions: mocks.fetchShopifyBalanceTransactions,
}));
vi.mock("./exchange-rate", async importOriginal => ({
  ...(await importOriginal<typeof import("./exchange-rate")>()),
  getEurUsdRate: mocks.getEurUsdRate,
}));

import { appRouter } from "./routers";
const context = (): TrpcContext => ({
  user: { id: 1, role: "user", email: "audit@example.invalid" } as TrpcContext["user"],
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: { clearCookie: () => {}, cookie: () => {} } as TrpcContext["res"],
});
const period = { storeId: 42, fromDate: "2026-10-02", toDate: "2026-10-02" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getStoreById.mockResolvedValue({ id: 42, userId: 1, currency: "USD", timezone: "America/New_York", timezoneOffset: -300 });
  mocks.getShopifyConnectionByStoreId.mockResolvedValue({
    shopDomain: "store.myshopify.com", accessToken: "mock", apiVersion: "2026-07", scopes: "read_orders,read_shopify_payments_payouts,read_shopify_payments_disputes",
  });
  mocks.getFacebookConnectionsByStoreId.mockResolvedValue([]);
  mocks.getCogsConfigByStoreId.mockResolvedValue([{ variantId: "1", cogsValue: "20", currency: "USD" }]);
  mocks.getShippingConfigByStoreId.mockResolvedValue([{
    variantId: "1", configJson: JSON.stringify({ currency: "USD", rates: { US: { Standard: { "1": 5 } } } }),
  }]);
  mocks.getProcessingFeesConfigByStoreId.mockResolvedValue({ percentFee: "0.028", fixedFee: "0.29" });
  mocks.getOperationalExpensesByStoreId.mockResolvedValue([]);
  mocks.getEurUsdRate.mockResolvedValue(1.2);
  mocks.fetchShopifyOrders.mockResolvedValue([{
    id: "42", order_number: 42, created_at: "2026-10-02T15:00:00Z", total_price: "100.00", currency: "USD",
    financial_status: "paid", test: false,
    line_items: [{ variant_id: 1, quantity: 1, price: "100.00" }],
    shipping_address: { country: "US" }, shipping_lines: [],
  }]);
  mocks.fetchShopifyDisputes.mockResolvedValue({
    count: 1, wonCount: 1, lostCount: 0, acceptedCount: 0, refundedCount: 0,
    pendingCount: 0, preventedCount: 0, amountsByCurrency: { USD: { won: 100 } },
  });
  mocks.fetchShopifyBalanceTransactions.mockResolvedValue({
    orderFees: new Map([[42, 3]]), chargeFeesTotal: 3,
    totalDisputeValue: 100, totalDisputeFees: 15,
    totalDisputeRecovered: 100, totalDisputeFeesRecovered: 15,
    totalRefunds: 20, refundFeeAdjustments: 0,
    pageCount: 1, fxApproximate: false, unclassifiedTypes: [], holdMovement: 0,
  });
});

describe("dashboard profit with payment-posting dates", () => {
  it("uses actual signed ledger debits and credits once, with no fixed fee per case", async () => {
    const result = await appRouter.createCaller(context()).metrics.getProfit(period);
    expect(result.disputeCases.won).toBe(1);
    expect(result.disputeValue).toBe(100);
    expect(result.disputeRecovered).toBe(100);
    expect(result.disputeFees).toBe(15);
    expect(result.disputeFeesRecovered).toBe(15);
    expect(result.processingFees).toBe(3);
    expect(result.refunds).toBe(20);
    expect(result.orders).toBe(1);
    expect(result.exchangeRateUsed).toBe(1.2);
    expect(result.revenue - result.totalCosts).toBe(result.netProfit);
    expect(result.dataQuality.shopifyConnected).toBe(true);
    expect(mocks.fetchShopifyBalanceTransactions).toHaveBeenCalledWith(
      "store.myshopify.com", "mock", { fromDate: period.fromDate, toDate: period.toDate },
      "2026-07", 1.2, -300, "America/New_York"
    );
  });

  it("credits a past order's actual dispute reversal on its posting date, without a new sale or status-derived fee", async () => {
    mocks.fetchShopifyOrders.mockResolvedValue([]);
    mocks.fetchShopifyDisputes.mockResolvedValue({
      count: 0, wonCount: 0, lostCount: 0, acceptedCount: 0,
      refundedCount: 0, pendingCount: 0, preventedCount: 0, amountsByCurrency: {},
    });
    mocks.fetchShopifyBalanceTransactions.mockResolvedValue({
      orderFees: new Map(), chargeFeesTotal: 0,
      totalDisputeValue: 0, totalDisputeFees: 0,
      totalDisputeRecovered: 100, totalDisputeFeesRecovered: 0,
      totalRefunds: 0, refundFeeAdjustments: 0,
      pageCount: 1, fxApproximate: false, unclassifiedTypes: [], holdMovement: 0,
    });
    const result = await appRouter.createCaller(context()).metrics.getProfit(period);
    expect(result.revenue).toBe(0);
    expect(result.disputeCases.won).toBe(0);
    expect(result.disputeRecovered).toBe(100);
    expect(result.disputeFeesRecovered).toBe(0);
    expect(result.netProfit).toBe(100);
  });

  it("surfaces a denied payout ledger instead of reporting a verified zero", async () => {
    mocks.fetchShopifyBalanceTransactions.mockRejectedValue(new Error("Shopify Payments ledger unavailable (HTTP 403)"));
    await expect(appRouter.createCaller(context()).metrics.getProfit(period)).rejects.toThrow("HTTP 403");
  });

  it("marks a disconnected store as unverified rather than certified zero profit", async () => {
    mocks.getShopifyConnectionByStoreId.mockResolvedValue(null);
    const result = await appRouter.createCaller(context()).metrics.getProfit(period);
    expect(result.dataQuality.shopifyConnected).toBe(false);
    expect(result.dataQuality.paymentsVerified).toBe(false);
    expect(result.dataQuality.warnings.join(" ")).toContain("Zero is not a verified profit");
    expect(mocks.fetchShopifyOrders).not.toHaveBeenCalled();
  });
});
