export const SHIPPING_COUNTRIES = ["US", "EU", "CA", "UK", "AU", "NZ"] as const;
export type ShippingCountry = (typeof SHIPPING_COUNTRIES)[number];

const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  "AUSTRIA", "BELGIUM", "BULGARIA", "CROATIA", "CYPRUS", "CZECHIA", "CZECH REPUBLIC",
  "DENMARK", "ESTONIA", "FINLAND", "FRANCE", "GERMANY", "GREECE", "HUNGARY", "IRELAND",
  "ITALY", "LATVIA", "LITHUANIA", "LUXEMBOURG", "MALTA", "NETHERLANDS", "POLAND",
  "PORTUGAL", "ROMANIA", "SLOVAKIA", "SLOVENIA", "SPAIN", "SWEDEN", "EU",
]);

export function shippingCountry(country?: string | null): ShippingCountry | null {
  const code = country?.trim().toUpperCase();
  if (!code) return null;
  if (["US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA"].includes(code)) return "US";
  if (["CA", "CANADA"].includes(code)) return "CA";
  if (["GB", "GBR", "UK", "UNITED KINGDOM", "GREAT BRITAIN"].includes(code)) return "UK";
  if (["AU", "AUS", "AUSTRALIA"].includes(code)) return "AU";
  if (["NZ", "NZL", "NEW ZEALAND"].includes(code)) return "NZ";
  return EU_COUNTRIES.has(code) ? "EU" : null;
}
