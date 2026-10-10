/**
 * Exchange Rate Service
 * Fetches live EUR/USD exchange rates from ExchangeRate-API
 */

interface ExchangeRateResponse {
  result: string;
  base_code: string;
  time_last_update_unix: number;
  time_next_update_unix: number;
  rates: Record<string, number>;
}

let cachedRate: number | null = null;
let cacheExpiry: number = 0;
let cachedUsdRates: Record<string, number> | null = null;

/**
 * Fetch live EUR/USD exchange rate
 * Caches the result for 24 hours to respect rate limits
 */
export async function getEurUsdRate(): Promise<number> {
  const now = Date.now();

  // Return cached rate if still valid
  if (cachedRate && now < cacheExpiry) {
    return cachedRate;
  }

  try {
    // Fetch from ExchangeRate-API (USD to EUR)
    const response = await fetch("https://open.er-api.com/v6/latest/USD", { redirect: 'error', signal: AbortSignal.timeout(15000) });
    
    if (!response.ok) {
      throw new Error(`Exchange rate API returned ${response.status}`);
    }

    const data: ExchangeRateResponse = await response.json();

    if (data.result !== "success" || data.base_code !== 'USD' || !Number.isFinite(data.rates?.EUR) || data.rates.EUR <= 0 ||
      data.rates.USD !== 1 || !Number.isFinite(data.time_next_update_unix) || data.time_next_update_unix * 1000 <= now) {
      throw new Error("Invalid exchange rate API response");
    }

    // USD to EUR rate (e.g., 1 USD = 0.92 EUR means EUR/USD = 1.087)
    const usdToEur = data.rates.EUR;
    const eurToUsd = 1 / usdToEur;

    // Cache for 24 hours
    cachedRate = eurToUsd;
    cachedUsdRates = Object.fromEntries(Object.entries(data.rates).filter(([, value]) => Number.isFinite(value) && value > 0).map(([currency, value]) => [currency, 1 / value]));
    cacheExpiry = data.time_next_update_unix * 1000;

    console.log(`[Exchange Rate] Updated EUR/USD rate: ${eurToUsd.toFixed(4)} (valid until ${new Date(cacheExpiry).toISOString()})`);

    return eurToUsd;
  } catch (error) {
    console.error("[Exchange Rate] Failed to fetch live rate:", error);

    throw new Error('Reporting exchange rates could not be verified. Refresh again; profit was not calculated using a guessed rate.');
  }
}

/** Rates are USD per unit of each currency; these are current estimates. */
export async function getUsdReportingRates(): Promise<Record<string, number>> {
  await getEurUsdRate();
  if (!cachedUsdRates) throw new Error('Reporting exchange rates are unavailable');
  return { ...cachedUsdRates };
}

/**
 * Get the current cached rate without fetching
 * Returns null if no rate is cached
 */
export function getCachedRate(): { rate: number; expiresAt: number } | null {
  if (cachedRate && Date.now() < cacheExpiry) {
    return {
      rate: cachedRate,
      expiresAt: cacheExpiry,
    };
  }
  return null;
}
