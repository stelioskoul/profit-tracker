import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyShopifyFinancialAccess } from "./shopify-oauth";

const original = globalThis.fetch;
afterEach(() => vi.stubGlobal("fetch", original));

describe("Shopify financial permissions", () => {
  it("checks order, dispute and ledger endpoints before recording actual granted scopes", async () => {
    const paths: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      paths.push(new URL(url).pathname);
      return new Response(JSON.stringify({ access_scopes: [{ handle: "read_orders" }, { handle: "read_shopify_payments_payouts" }] }), { status: 200 });
    }));
    expect(await verifyShopifyFinancialAccess("store.myshopify.com", "token"))
      .toBe("read_orders,read_shopify_payments_payouts");
    expect(paths).toEqual([
      "/admin/api/2026-07/orders.json",
      "/admin/api/2026-07/shopify_payments/disputes.json",
      "/admin/api/2026-07/shopify_payments/balance/transactions.json",
      "/admin/oauth/access_scopes.json",
    ]);
  });

  it("does not approve a token whose payout ledger returns forbidden", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response("{}", {
      status: url.includes("balance/transactions") ? 403 : 200,
    })));
    await expect(verifyShopifyFinancialAccess("store.myshopify.com", "token"))
      .rejects.toThrow("payout ledger access unavailable (HTTP 403)");
  });
});
