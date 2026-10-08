import type { Express, Request, Response } from "express";
import * as db from "../db";
import { verifyOAuthState } from "../oauth-state";
import { exchangeShopifyCode, normalizeShopDomain, verifyShopifyFinancialAccess, verifyShopifyHmac } from "../shopify-oauth";
import { exchangeFacebookCode, prepareFacebookToken, getFacebookAdAccounts, FacebookPermissionError } from "../facebook-oauth";
import { stageFacebookToken } from "../facebook-pending";
import { getSessionUserId } from "./sdk";

function queryString(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

async function authorizedStore(req: Request, state: string, provider: "shopify" | "facebook") {
  const { userId, storeId } = await verifyOAuthState(state, provider);
  const sessionUserId = await getSessionUserId(req);
  if (sessionUserId !== userId) throw new Error("OAuth session does not match state");
  const [user, store] = await Promise.all([db.getUserById(userId), db.getStoreById(storeId)]);
  if (!user || !store || store.userId !== user.id) throw new Error("Store access denied");
  return storeId;
}

export function registerOAuthRoutes(app: Express) {
  // The old /api/oauth/callback exchanged tokens with the discontinued Manus
  // identity service. It must not be registered for this Supabase-backed app.
  app.get("/api/oauth/shopify/callback", async (req: Request, res: Response) => {
    const shop = queryString(req, "shop");
    const code = queryString(req, "code");
    const state = queryString(req, "state");
    const hmac = queryString(req, "hmac");
    if (!shop || !code || !state || !hmac) return res.status(400).json({ error: "Missing OAuth parameters" });

    try {
      const query = Object.fromEntries(
        Object.entries(req.query).filter((entry): entry is [string, string] => typeof entry[1] === "string")
      );
      if (!verifyShopifyHmac(query, hmac)) throw new Error("Invalid Shopify callback HMAC");
      const storeId = await authorizedStore(req, state, "shopify");
      const domain = normalizeShopDomain(shop);
      const token = await exchangeShopifyCode(domain, code);
      const grantedScopes = await verifyShopifyFinancialAccess(domain, token.access_token);
      await db.upsertShopifyConnection({
        storeId,
        shopDomain: domain,
        accessToken: token.access_token,
        scopes: grantedScopes || token.scope,
        apiVersion: "2026-07",
      });
      return res.redirect(302, `/store/${storeId}/connections`);
    } catch (error) {
      console.error("[Shopify OAuth] Callback rejected:", error instanceof Error ? error.message : String(error));
      return res.status(403).json({ error: "Shopify connection failed. Ensure the app has orders, disputes and Shopify Payments payout access, then sign in and retry." });
    }
  });

  app.get("/api/oauth/facebook/callback", async (req: Request, res: Response) => {
    const state = queryString(req, "state");
    let storeId: number | undefined;
    try {
      if (!state) throw new Error("Missing OAuth state");
      storeId = await authorizedStore(req, state, "facebook");
      if (queryString(req, "error")) return res.redirect(302, `/store/${storeId}/connections?facebook=cancelled`);
      const code = queryString(req, "code");
      if (!code) throw new Error("Missing OAuth code");
      const baseUrl = process.env.APP_URL;
      if (!baseUrl) throw new Error("APP_URL is not configured");
      const redirectUri = `${baseUrl.replace(/\/$/, "")}/api/oauth/facebook/callback`;
      const shortToken = await exchangeFacebookCode(code, redirectUri);
      const token = await prepareFacebookToken(shortToken.access_token);
      const accounts = await getFacebookAdAccounts(token.accessToken);
      if (accounts.length === 0) return res.redirect(302, `/store/${storeId}/connections?facebook=no_accounts`);
      const userId = await getSessionUserId(req);
      if (!userId) throw new Error("OAuth session expired");
      await stageFacebookToken(res, req, userId, storeId, token.accessToken);
      // The user chooses the account after login. Never silently attach accounts[0].
      return res.redirect(302, `/store/${storeId}/connections?facebook=select`);
    } catch (error) {
      console.error("[Facebook OAuth] Callback rejected:", error instanceof Error ? error.message : "Invalid callback");
      if (storeId) return res.redirect(302, `/store/${storeId}/connections?facebook=${error instanceof FacebookPermissionError ? "permission_missing" : "failed"}`);
      return res.status(403).json({ error: "Facebook connection failed; sign in and retry" });
    }
  });
}
