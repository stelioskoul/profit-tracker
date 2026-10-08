import { getSessionSecret } from "./_core/sdk";
import { validateTokenEncryptionKey } from "./token-crypto";

export function validateRuntimeConfiguration(): void {
  const databaseUrl = process.env.DATABASE_URL;
  try {
    const uri = new URL(databaseUrl || "");
    if (!["postgres:", "postgresql:"].includes(uri.protocol) || !uri.hostname || !uri.username || !uri.password) {
      throw new Error("incomplete database URI");
    }
  } catch {
    let parsed: URL | undefined;
    try { parsed = new URL(databaseUrl || ""); } catch { /* report only safe shape flags */ }
    console.error("Beprofit database configuration shape:", JSON.stringify({
      present: Boolean(databaseUrl),
      parseable: Boolean(parsed),
      postgresScheme: ["postgres:", "postgresql:"].includes(parsed?.protocol || ""),
      hostPresent: Boolean(parsed?.hostname),
      usernamePresent: Boolean(parsed?.username),
      passwordPresent: Boolean(parsed?.password),
    }));
    throw new Error("DATABASE_URL must be a private PostgreSQL connection URI");
  }

  getSessionSecret();
  validateTokenEncryptionKey();

  const origin = process.env.APP_URL;
  if (origin) {
    let url: URL;
    try { url = new URL(origin); }
    catch { throw new Error("APP_URL must be a valid public origin"); }
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
        !(url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) {
      throw new Error("APP_URL must be an HTTPS origin or local HTTP loopback origin");
    }
  }

  if ((process.env.SHOPIFY_CLIENT_ID || process.env.FACEBOOK_APP_ID) &&
      (!origin || !origin.startsWith("https://")) && process.env.NODE_ENV === "production") {
    throw new Error("APP_URL must be an HTTPS origin when provider OAuth is configured");
  }
}
