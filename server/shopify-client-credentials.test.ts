import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const domain = "old-shop.myshopify.com";
const configure = (clientSecret = "fixture-secret") => vi.stubEnv("SHOPIFY_CLIENT_CREDENTIALS", JSON.stringify({
  [domain]: { userId: 20, clientId: "fixture-id", clientSecret, label: "Old shop" },
  "new-shop.myshopify.com": { userId: 30, clientId: "new-id", clientSecret: "new-secret" },
}));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-08T12:00:00Z"));
  configure();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Shopify client credentials", () => {
  it("only lists the account's configured domains and public labels", async () => {
    const { configuredShopifyStoresForUser } = await import("./shopify-client-credentials");
    expect(configuredShopifyStoresForUser(20)).toEqual([{ shopDomain: domain, label: "Old shop" }]);
    expect(configuredShopifyStoresForUser(99)).toEqual([]);
  });

  it("does not request a token for a different account or unconfigured shop", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { getConfiguredShopifyToken } = await import("./shopify-client-credentials");
    expect(await getConfiguredShopifyToken(domain, 30)).toBeUndefined();
    expect(await getConfiguredShopifyToken("other.myshopify.com", 20)).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("coalesces token requests, caches them, and renews before expiration", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ access_token: "fixture-token", scope: "read_orders", expires_in: 86399 })));
    vi.stubGlobal("fetch", fetchMock);
    const { getConfiguredShopifyToken } = await import("./shopify-client-credentials");
    const tokens = await Promise.all([getConfiguredShopifyToken(domain, 20), getConfiguredShopifyToken(domain, 20)]);
    expect(tokens[0]?.accessToken).toBe("fixture-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`https://${domain}/admin/oauth/access_token`);
    expect(fetchMock.mock.calls[0][1].redirect).toBe("error");
    await getConfiguredShopifyToken(domain, 20);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 86_340_000);
    await getConfiguredShopifyToken(domain, 20);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("discards cached tokens after credential rotation", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ access_token: "fixture-token", scope: "read_orders", expires_in: 86399 })));
    vi.stubGlobal("fetch", fetchMock);
    const { getConfiguredShopifyToken } = await import("./shopify-client-credentials");
    await getConfiguredShopifyToken(domain, 20);
    configure("rotated-fixture");
    await getConfiguredShopifyToken(domain, 20);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects non-Shopify hosts and reports malformed configuration without its secrets", async () => {
    vi.stubEnv("SHOPIFY_CLIENT_CREDENTIALS", '{"attacker.example":{"userId":20,"clientId":"fixture-id","clientSecret":"fixture-secret"}}');
    const { readShopifyClientCredentials } = await import("./shopify-client-credentials");
    expect(() => readShopifyClientCredentials()).toThrow("SHOPIFY_CLIENT_CREDENTIALS");
    try { readShopifyClientCredentials(); } catch (error) { expect(String(error)).not.toContain("fixture-secret"); }
  });

  it("does not include provider error bodies or network errors in the error sent to clients", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("fixture-private-error", { status: 401 }))
      .mockRejectedValueOnce(new Error("fixture-private-network-error"));
    vi.stubGlobal("fetch", fetchMock);
    const { getConfiguredShopifyToken } = await import("./shopify-client-credentials");
    await expect(getConfiguredShopifyToken(domain, 20)).rejects.toThrow("Unable to renew the Shopify connection (401)");
    await expect(getConfiguredShopifyToken(domain, 20)).rejects.toThrow(/^Unable to renew the Shopify connection$/);
  });

  it("rejects token responses without a usable expiration", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: "fixture-token", scope: "read_orders" }))));
    const { getConfiguredShopifyToken } = await import("./shopify-client-credentials");
    await expect(getConfiguredShopifyToken(domain, 20)).rejects.toThrow("Invalid Shopify token response");
  });
});
