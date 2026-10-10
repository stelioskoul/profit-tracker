import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchStripeLedger, summarizeStripePostings, verifyStripeConnection, type StripePosting } from './stripe-data';
const row = (id: string, category: string, amount: number, fee = 0, currency = 'eur'): StripePosting =>
  ({ id, reporting_category: category, amount, fee, net: amount - fee, currency, type: 'adjustment', created: Date.parse('2026-10-02T15:00:00Z') / 1000 });
const json = (data: object) => new Response(JSON.stringify(data), { status: 200 });
afterEach(() => vi.unstubAllGlobals());

describe('Stripe posted payment accounting', () => {
  it('uses partial recoveries and signed response-fee credits, excludes payouts and reserve holds, and never adds charge sales', () => {
    const result = summarizeStripePostings([
      row('sale', 'charge', 10000, 350), row('withdraw', 'dispute', -10000, 2000),
      row('recover', 'dispute_reversal', 4000), row('response-fee', 'fee', -2000),
      row('response-credit', 'fee', 2000), row('payout', 'payout', -50000), row('hold', 'risk_reserved_funds', -20000),
    ], 1.2);
    expect(result.byCurrency.EUR).toMatchObject({ processingFees: 3.5, disputeDebits: 100, disputeFees: 20,
      disputeRecoveries: 40, disputeFeeRecoveries: 0, disputeNetLoss: 80 });
    expect(result.reporting.processingFees).toBe(4.2);
    expect(result.reporting.disputeDebits + result.reporting.disputeFees - result.reporting.disputeRecoveries).toBe(96);
  });
  it('books failed-refund reversals once and excludes partial-capture reversals from customer refunds', () => {
    const result = summarizeStripePostings([row('refund', 'refund', -4000), row('failure', 'refund_failure', 4000),
      row('uncaptured', 'partial_capture_reversal', -6000)], 1);
    expect(result.reporting.refunds).toBe(0);
    expect(result.unclassifiedCount).toBe(0);
  });
  it('books only an actual negative fee on a dispute recovery as a returned fee', () => {
    expect(summarizeStripePostings([row('credit', 'dispute_reversal', 2500, -2000)], 1).byCurrency.EUR)
      .toMatchObject({ disputeRecoveries: 25, disputeFeeRecoveries: 20, disputeNetLoss: -45 });
  });
  it('rejects inconsistent cents and duplicate postings and flags unknown adjustments', () => {
    expect(() => summarizeStripePostings([{ ...row('bad', 'dispute', -100), net: -99 }], 1)).toThrow('inconsistent');
    expect(() => summarizeStripePostings([row('same', 'fee', -100), row('same', 'fee', -100)], 1)).toThrow('duplicate');
    expect(summarizeStripePostings([row('unknown', 'other_adjustment', -123)], 1)).toMatchObject({ unclassifiedCount: 1, reporting: { unclassifiedNet: -1.23 } });
  });
  it('uses all cursor pages within store-local midnight bounds and reads no write endpoint', async () => {
    const charge = { id: 'ch_test', object: 'charge', livemode: true, metadata: { shopify_shop_domain: 'store.myshopify.com' } };
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ data: [{ ...row('first', 'charge', 10000, 350), source: charge }], has_more: true }))
      .mockResolvedValueOnce(json({ data: [{ ...row('second', 'dispute', -10000, 2000), source: { id: 'du_test', object: 'dispute', charge: 'ch_test' } }], has_more: false }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchStripeLedger('rk_live_mock', 'store.myshopify.com', { fromDate: '2026-10-02', toDate: '2026-10-02' }, 1.2, -300, 'America/Bogota');
    expect(result.pageCount).toBe(2);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get('created[gte]')).toBe(String(Date.parse('2026-10-02T05:00:00Z') / 1000));
    expect(url.searchParams.get('created[lt]')).toBe(String(Date.parse('2026-10-03T05:00:00Z') / 1000));
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('starting_after')).toBe('first');
    expect(fetchMock.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
  });
  it('rejects another store’s payments and denied permissions instead of returning verified zero', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: [{ ...row('first', 'charge', 10000, 350), source: { id: 'ch_other', object: 'charge', livemode: true, metadata: { shopify_shop_domain: 'other.myshopify.com' } } }], has_more: false })));
    await expect(fetchStripeLedger('rk_live_mock', 'store.myshopify.com', { fromDate: '2026-10-02', toDate: '2026-10-02' }, 1)).rejects.toThrow('another Shopify store');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })));
    await expect(fetchStripeLedger('rk_live_mock', 'store.myshopify.com', { fromDate: '2026-10-02', toDate: '2026-10-02' }, 1)).rejects.toThrow('HTTP 403');
  });
  it('refuses full-access or test keys before making any request', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(verifyStripeConnection('sk_live_secret', 'store.myshopify.com')).rejects.toThrow('restricted');
    await expect(verifyStripeConnection('rk_test_secret', 'store.myshopify.com')).rejects.toThrow('restricted');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
