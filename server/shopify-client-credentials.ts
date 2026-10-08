import { createHash } from "node:crypto";
import { normalizeShopDomain } from "./shopify-oauth";

type Credentials = { userId: number; clientId: string; clientSecret: string; label?: string };
type ClientToken = { accessToken: string; scopes: string; expiresAt: number };
const cache = new Map<string, { fingerprint: string; token?: ClientToken; pending?: Promise<ClientToken> }>();

// This server-only configuration binds each installed Shopify app to one
// Profit Tracker account. Knowing a domain never grants another user access.
export function readShopifyClientCredentials(): Map<string, Credentials> {
  const raw = process.env.SHOPIFY_CLIENT_CREDENTIALS;
  if (!raw) return new Map();
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    const entries = new Map<string, Credentials>();
    for (const [domain, value] of Object.entries(parsed)) {
      const config = value as Credentials;
      if (normalizeShopDomain(domain) !== domain || !config ||
          !Number.isSafeInteger(config.userId) || config.userId < 1 ||
          typeof config.clientId !== "string" || !config.clientId.trim() ||
          typeof config.clientSecret !== "string" || !config.clientSecret.trim() ||
          (config.label !== undefined && typeof config.label !== "string")) throw new Error();
      entries.set(domain, config);
    }
    return entries;
  } catch {
    // Never include the raw configuration or parser error, which contain secrets.
    throw new Error("SHOPIFY_CLIENT_CREDENTIALS must contain valid account-bound Shopify app credentials");
  }
}

export function configuredShopifyStoresForUser(userId: number) {
  return Array.from(readShopifyClientCredentials()).filter(([, config]) => config.userId === userId)
    .map(([shopDomain, config]) => ({ shopDomain, label: config.label || shopDomain }));
}

export async function getConfiguredShopifyToken(shopDomain: string, userId: number): Promise<ClientToken | undefined> {
  const domain = normalizeShopDomain(shopDomain);
  const credentials = readShopifyClientCredentials().get(domain);
  if (!credentials || credentials.userId !== userId) return undefined;
  const fingerprint = createHash("sha256").update(JSON.stringify(credentials)).digest("hex");
  let entry = cache.get(domain);
  if (!entry || entry.fingerprint !== fingerprint) {
    entry = { fingerprint };
    cache.set(domain, entry);
  }
  if (entry.token && Date.now() < entry.token.expiresAt - 60_000) return entry.token;
  if (entry.pending) return entry.pending;
  const currentEntry = entry;
  const requestedAt = Date.now();
  currentEntry.pending = (async () => {
    let response: Response;
    try {
      response = await fetch(`https://${domain}/admin/oauth/access_token`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: credentials.clientId, client_secret: credentials.clientSecret }),
      });
    } catch {
      throw new Error("Unable to renew the Shopify connection");
    }
    if (!response.ok) throw new Error(`Unable to renew the Shopify connection (${response.status})`);
    let result: { access_token?: unknown; expires_in?: unknown; scope?: unknown };
    try { result = await response.json(); }
    catch { throw new Error("Invalid Shopify token response"); }
    if (typeof result.access_token !== "string" || !result.access_token ||
        typeof result.expires_in !== "number" || !Number.isFinite(result.expires_in) || result.expires_in <= 60 ||
        typeof result.scope !== "string") throw new Error("Invalid Shopify token response");
    const token = { accessToken: result.access_token, scopes: result.scope, expiresAt: requestedAt + result.expires_in * 1000 };
    currentEntry.token = token;
    return token;
  })();
  try { return await currentEntry.pending; }
  finally { currentEntry.pending = undefined; }
}
