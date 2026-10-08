import { shopifyDateBounds, type ShopifyDateRange } from "./shopify-date";

/** Standard Shopify read_orders grants only the most recent 60 days. */
export function assertOrderHistoryAccess(
  range: ShopifyDateRange,
  grantedScopes: string | null | undefined,
  timezoneOffset = -300,
  timeZone?: string | null,
  now = Date.now()
): void {
  const { start } = shopifyDateBounds(range, timezoneOffset, timeZone);
  const scopes = new Set((grantedScopes || "").split(",").map(scope => scope.trim()));
  if (start < now - 60 * 24 * 60 * 60 * 1000 && !scopes.has("read_all_orders")) {
    throw new Error("Shopify limits this app to its most recent 60 days of orders. An older profit period requires Shopify-approved read_all_orders access; reconnect the store after granting it.");
  }
}
