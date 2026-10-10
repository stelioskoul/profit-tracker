import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => vi.unstubAllGlobals());
it('uses one verified USD-base quote consistently for EUR and other payment currencies', async () => {
  vi.resetModules();
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: 'success', base_code: 'USD', rates: { USD: 1, EUR: 0.8, AUD: 2 }, time_next_update_unix: Math.floor(Date.now() / 1000) + 3600 })));
  vi.stubGlobal('fetch', fetch);
  const rates = await import('./exchange-rate');
  expect(await rates.getEurUsdRate()).toBe(1.25);
  expect(await rates.getUsdReportingRates()).toEqual({ USD: 1, EUR: 1.25, AUD: 0.5 });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it.each([new Response('', { status: 503 }), new Response(JSON.stringify({ result: 'success', base_code: 'EUR', rates: { USD: 1, EUR: 0.8 } }))])('refuses guessed or malformed conversion rates when the provider is unavailable', async response => {
  vi.resetModules(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
  const rates = await import('./exchange-rate');
  await expect(rates.getEurUsdRate()).rejects.toThrow('could not be verified');
});
