import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({ getStoreById: vi.fn(), upsertShopifyConnection: vi.fn(), updateStore: vi.fn(), getConfiguredShopifyToken: vi.fn() }));
vi.mock("./db", async original => ({ ...(await original<typeof import("./db")>()), getStoreById: mocks.getStoreById, upsertShopifyConnection: mocks.upsertShopifyConnection, updateStore: mocks.updateStore }));
vi.mock("./shopify-client-credentials", async original => ({ ...(await original<typeof import("./shopify-client-credentials")>()), getConfiguredShopifyToken: mocks.getConfiguredShopifyToken }));
import { appRouter } from "./routers";

const context = { user: { id: 20, role: "user" }, req: { protocol: "https", headers: {} }, res: {} } as TrpcContext;
const input = { storeId: 10, shopDomain: "old-shop.myshopify.com" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getStoreById.mockResolvedValue({ id: 10, userId: 20 });
  mocks.getConfiguredShopifyToken.mockResolvedValue({ accessToken: "fixture-token", scopes: "read_orders,read_products", expiresAt: Date.now() + 86_399_000 });
});
afterEach(() => vi.unstubAllGlobals());

describe("configured Shopify connections", () => {
  it("rejects another user's profile before issuing a token", async () => {
    mocks.getStoreById.mockResolvedValue({ id: 10, userId: 30 });
    await expect(appRouter.createCaller(context).shopify.connectConfigured(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.getConfiguredShopifyToken).not.toHaveBeenCalled();
    expect(mocks.upsertShopifyConnection).not.toHaveBeenCalled();
  });
  it("rejects credentials that are not configured for the authenticated account", async () => {
    mocks.getConfiguredShopifyToken.mockResolvedValue(undefined);
    await expect(appRouter.createCaller(context).shopify.connectConfigured(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.upsertShopifyConnection).not.toHaveBeenCalled();
  });
  it("verifies the domain and saves the connection and Shopify reporting settings without returning secrets", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(
      url.endsWith("shop.json") ? { shop: { myshopify_domain: input.shopDomain, currency: "USD", iana_timezone: "America/Bogota" } } :
      { access_scopes: [{ handle: "read_orders" }, { handle: "read_shopify_payments_payouts" }] }
    ))));
    expect(await appRouter.createCaller(context).shopify.connectConfigured(input)).toEqual({ success: true });
    expect(mocks.getConfiguredShopifyToken).toHaveBeenCalledWith(input.shopDomain, 20);
    expect(mocks.upsertShopifyConnection).toHaveBeenCalledWith(expect.objectContaining({ storeId: 10, accessToken: "fixture-token", scopes: "read_orders,read_shopify_payments_payouts" }));
    expect(mocks.updateStore).toHaveBeenCalledWith(10, { currency: "USD", timezone: "America/Bogota", timezoneOffset: -300 });
  });
  it("does not save a connection when financial access is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify({
      shop: { myshopify_domain: input.shopDomain, currency: "USD", iana_timezone: "America/Bogota" }
    }), { status: url.includes("balance/transactions") ? 403 : 200 })));
    await expect(appRouter.createCaller(context).shopify.connectConfigured(input)).rejects.toThrow("payout ledger access unavailable (HTTP 403)");
    expect(mocks.upsertShopifyConnection).not.toHaveBeenCalled();
    expect(mocks.updateStore).not.toHaveBeenCalled();
  });
  it("does not save a connection whose verified Shopify identity differs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ shop: { myshopify_domain: "different.myshopify.com" } }))));
    await expect(appRouter.createCaller(context).shopify.connectConfigured(input)).rejects.toThrow("Shopify store identity does not match");
    expect(mocks.upsertShopifyConnection).not.toHaveBeenCalled();
  });
});
