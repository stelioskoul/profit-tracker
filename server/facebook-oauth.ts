import { createHmac } from "node:crypto";

export const FACEBOOK_API_VERSION = "v25.0";
export type FacebookAdAccount = { id: string; name: string; currency: string; timezone_name?: string; timezone_offset_hours_utc?: number };
export type FacebookTokenInfo = { type: string; expiresAt: Date | null };

function credentials() {
  const appId = process.env.FACEBOOK_APP_ID?.trim();
  const appSecret = process.env.FACEBOOK_APP_SECRET?.trim();
  if (!appId || !/^\d+$/.test(appId) || !appSecret) {
    throw new Error("Facebook login is not configured. Set the Facebook app credentials on the server.");
  }
  return { appId, appSecret };
}

export function getFacebookAuthUrl(redirectUri: string, state: string): string {
  const { appId } = credentials();
  const params = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, state, response_type: "code", scope: "ads_read", auth_type: "rerequest" });
  const configurationId = process.env.FACEBOOK_LOGIN_CONFIG_ID?.trim();
  if (configurationId) {
    if (!/^\d+$/.test(configurationId)) throw new Error("The Facebook business login configuration ID is invalid.");
    params.set("config_id", configurationId);
    params.set("override_default_response_type", "true");
  }
  return `https://www.facebook.com/${FACEBOOK_API_VERSION}/dialog/oauth?${params}`;
}

export class FacebookApiError extends Error {
  constructor(public readonly status: number, public readonly providerCode?: number) {
    super(providerCode === 190
      ? "Facebook access expired or was revoked. Reconnect this ad account."
      : `Facebook API request failed (HTTP ${status}${providerCode ? `, code ${providerCode}` : ""}). Check the app's ad-account permissions.`);
  }
}

export class FacebookPermissionError extends Error {
  constructor() {
    super("Facebook did not grant ads_read permission. Reconnect and allow read-only ad-report access.");
  }
}

// Provider responses and request URLs can contain credentials. Never include them
// in exceptions or logs. Tokens travel in headers except Meta's token inspection input.
export async function facebookJson(path: string, token: string, params: Record<string, string> = {}, version = FACEBOOK_API_VERSION): Promise<any> {
  const url = new URL(`https://graph.facebook.com/${version}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const secret = process.env.FACEBOOK_APP_SECRET;
  if (secret && !token.includes("|")) url.searchParams.set("appsecret_proof", createHmac("sha256", secret).update(token).digest("hex"));
  let response: Response;
  try {
    response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(15_000) });
  } catch { throw new Error("Facebook could not be reached. Please try again."); }
  let body: any;
  try { body = await response.json(); } catch { throw new FacebookApiError(response.status); }
  if (!response.ok || body.error) throw new FacebookApiError(response.status, body.error?.code);
  return body;
}

async function exchange(params: Record<string, string>): Promise<{ access_token: string; expires_in?: number }> {
  const { appId, appSecret } = credentials();
  const url = `https://graph.facebook.com/${FACEBOOK_API_VERSION}/oauth/access_token`;
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: appId, client_secret: appSecret, ...params }) });
  } catch { throw new Error("Facebook token exchange could not be completed. Please retry login."); }
  let body: any;
  try { body = await response.json(); } catch { throw new FacebookApiError(response.status); }
  if (!response.ok || body.error) throw new FacebookApiError(response.status, body.error?.code);
  if (typeof body.access_token !== "string" || !body.access_token) throw new Error("Facebook returned an invalid token response.");
  return body;
}

export function exchangeFacebookCode(code: string, redirectUri: string) {
  return exchange({ redirect_uri: redirectUri, code });
}
export function exchangeForLongLivedToken(token: string) {
  return exchange({ grant_type: "fb_exchange_token", fb_exchange_token: token });
}

export async function inspectFacebookToken(token: string): Promise<FacebookTokenInfo> {
  const { appId, appSecret } = credentials();
  const { data } = await facebookJson("debug_token", `${appId}|${appSecret}`, { input_token: token });
  if (!data?.is_valid) throw new Error("Facebook access expired or was revoked. Reconnect this ad account.");
  if (String(data.app_id) !== appId) throw new Error("This token belongs to a different Facebook app.");
  const scopes = Array.isArray(data.scopes) ? data.scopes : [];
  const granularScopes = Array.isArray(data.granular_scopes) ? data.granular_scopes.map((item: any) => item?.scope) : [];
  if (!scopes.includes("ads_read") && !granularScopes.includes("ads_read")) {
    // Scope names and token type are safe diagnostics; never log the token,
    // debug response, user identifiers, asset IDs, or provider URLs.
    const safeScopes = (value: unknown) => Array.isArray(value) ? value.filter((scope): scope is string => typeof scope === "string" && /^[a-z_]{1,64}$/.test(scope)).slice(0, 30) : [];
    console.warn("[Facebook OAuth] Read permission missing", {
      type: ["USER", "SYSTEM_USER"].includes(data.type) ? data.type : "unknown",
      scopes: safeScopes(scopes),
      granularScopes: safeScopes(granularScopes),
    });
    throw new FacebookPermissionError();
  }
  if (!["USER", "SYSTEM_USER"].includes(data.type)) throw new Error("Use a Facebook user or business system-user token.");
  const times = [data.expires_at, data.data_access_expires_at];
  if (typeof data.expires_at !== "number" || times.some(time => time !== undefined && (typeof time !== "number" || !Number.isFinite(time) || time < 0))) throw new Error("Facebook did not provide a valid token expiration.");
  const positive = times.filter((time): time is number => typeof time === "number" && time > 0);
  const expiresAt = positive.length ? new Date(Math.min(...positive) * 1000) : null;
  if (expiresAt && expiresAt.getTime() <= Date.now()) throw new Error("Facebook access expired. Reconnect this ad account.");
  return { type: data.type, expiresAt };
}

export async function prepareFacebookToken(token: string) {
  let info = await inspectFacebookToken(token);
  // Business login returns system-user tokens directly. Only short-lived user
  // tokens need the exchange; no invented expiry and no promised silent refresh.
  if (info.type === "USER" && info.expiresAt && info.expiresAt.getTime() - Date.now() < 7 * 86_400_000) {
    token = (await exchangeForLongLivedToken(token)).access_token;
    info = await inspectFacebookToken(token);
  }
  return { accessToken: token, ...info };
}

export function normalizeFacebookAdAccountId(value: string): string {
  const id = value.replace(/^act_/, "").trim();
  if (!/^\d+$/.test(id)) throw new Error("Enter a valid Facebook ad account ID.");
  return `act_${id}`;
}

export async function getFacebookAdAccounts(token: string): Promise<FacebookAdAccount[]> {
  const accounts: FacebookAdAccount[] = [];
  let after: string | undefined;
  const seen = new Set<string>();
  do {
    const body = await facebookJson("me/adaccounts", token, { fields: "id,name,account_status,currency,timezone_name,timezone_offset_hours_utc", limit: "100", ...(after ? { after } : {}) });
    if (!Array.isArray(body.data)) throw new Error("Facebook returned an invalid ad-account list.");
    accounts.push(...body.data);
    const next = body.paging?.next ? body.paging?.cursors?.after : undefined;
    if (next && (typeof next !== "string" || seen.has(next))) throw new Error("Facebook ad-account pagination could not be completed.");
    if (next) seen.add(next);
    after = next;
  } while (after);
  return accounts;
}

export async function verifyFacebookAdAccount(token: string, accountId: string): Promise<FacebookAdAccount> {
  const id = normalizeFacebookAdAccountId(accountId);
  const account = await facebookJson(id, token, { fields: "id,name,currency,timezone_name,timezone_offset_hours_utc" });
  if (account.id !== id || typeof account.name !== "string" || !/^[A-Z]{3}$/.test(account.currency)) throw new Error("Facebook returned invalid ad-account details.");
  // Actual Insights access is required, even when the account metadata is readable.
  await facebookJson(`${id}/insights`, token, { fields: "spend", level: "account", date_preset: "today", limit: "1" });
  return account;
}
