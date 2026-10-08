import { facebookJson } from "./facebook-oauth";
/**
 * Facebook Marketing API data fetching utilities
 * Migrated from original Netlify functions
 */

interface DateRange {
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD
}

export async function fetchFacebookAdSpend(
  adAccountId: string,
  accessToken: string,
  dateRange: DateRange,
  apiVersion: string = "v25.0"
): Promise<{ spend: number; currency: string }> {
  // Ensure account ID has act_ prefix
  const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;

  const url = new URL(`https://graph.facebook.com/${apiVersion}/${accountId}/insights`);
  url.searchParams.set("fields", "spend");
  url.searchParams.set(
    "time_range",
    JSON.stringify({ since: dateRange.fromDate, until: dateRange.toDate })
  );
  url.searchParams.set("level", "account");

  const data = await facebookJson(`${accountId}/insights`, accessToken, Object.fromEntries(url.searchParams), apiVersion);
  let spend = 0;

  if (Array.isArray(data.data) && data.data.length > 0) {
    spend = Number(data.data[0].spend);
    if (!Number.isFinite(spend) || spend < 0) {
      throw new Error("Facebook returned invalid ad spend");
    }
  }

  // Get account currency
  const accountData = await facebookJson(accountId, accessToken, { fields: "currency" }, apiVersion);
  const currency = accountData.currency?.toUpperCase();
  if (!currency) throw new Error("Facebook account currency is missing");

  return { spend, currency };
}
