import { createHmac, timingSafeEqual } from "node:crypto";

/** Shopify OAuth must never send credentials to an arbitrary caller-supplied host. */
export function normalizeShopDomain(value: string): string {
  const domain = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) {
    throw new Error("Use a valid .myshopify.com store domain");
  }
  return domain;
}

const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID!;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET!;
const SHOPIFY_SCOPES = "read_orders,read_products,read_customers,read_shopify_payments_disputes,read_shopify_payments_payouts";

export function getShopifyAuthUrl(shop: string, state: string, redirectUri: string): string {
  if (!SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) {
    throw new Error("Shopify OAuth credentials are not configured; use a manual store connection");
  }
  const params = new URLSearchParams({
    client_id: SHOPIFY_CLIENT_ID,
    scope: SHOPIFY_SCOPES,
    redirect_uri: redirectUri,
    state,
  });
  return `https://${normalizeShopDomain(shop)}/admin/oauth/authorize?${params.toString()}`;
}

export async function exchangeShopifyCode(
  shop: string,
  code: string
): Promise<{ access_token: string; scope: string }> {
  const url = `https://${normalizeShopDomain(shop)}/admin/oauth/access_token`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: SHOPIFY_CLIENT_ID, client_secret: SHOPIFY_CLIENT_SECRET, code }),
  });
  if (!response.ok) throw new Error(`Shopify token exchange failed: ${response.status}`);
  return await response.json();
}

/** Probe the APIs used for profit, not merely shop.json; never persist an unusable token. */
export async function verifyShopifyFinancialAccess(shop: string, accessToken: string): Promise<string> {
  const domain = normalizeShopDomain(shop);
  const headers = { "X-Shopify-Access-Token": accessToken };
  const endpoints = [
    ["orders", `/admin/api/2026-07/orders.json?limit=1&fields=id`],
    ["disputes", `/admin/api/2026-07/shopify_payments/disputes.json?limit=1`],
    ["Shopify Payments payout ledger", `/admin/api/2026-07/shopify_payments/balance/transactions.json?limit=1`],
  ] as const;
  for (const [label, path] of endpoints) {
    const response = await fetch(`https://${domain}${path}`, { headers });
    if (!response.ok) {
      throw new Error(`Shopify ${label} access unavailable (HTTP ${response.status}). Grant read_orders, read_shopify_payments_disputes and read_shopify_payments_payouts, then reconnect.`);
    }
  }
  const response = await fetch(`https://${domain}/admin/oauth/access_scopes.json`, { headers });
  if (!response.ok) return "verified_api_access";
  const data = await response.json();
  if (!Array.isArray(data.access_scopes)) return "verified_api_access";
  return data.access_scopes.map((scope: { handle?: string }) => scope.handle).filter(Boolean).join(",");
}

export function verifyShopifyHmac(query: Record<string, string>, hmac: string): boolean {
  if (!SHOPIFY_CLIENT_SECRET || !/^[a-f0-9]{64}$/i.test(hmac)) return false;
  const message = Object.keys(query)
    .filter(key => key !== "hmac" && key !== "signature")
    .sort()
    .map(key => `${key}=${query[key]}`)
    .join("&");
  const expected = createHmac("sha256", SHOPIFY_CLIENT_SECRET).update(message).digest();
  return timingSafeEqual(expected, Buffer.from(hmac, "hex"));
}
