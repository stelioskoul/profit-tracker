import { afterEach, describe, expect, it, vi } from 'vitest';
import { allocatePayPalPostings, getPayPalReportingToken, readPayPalPostings, summarizePayPalPostings, verifyPayPalShopifyIdentity, type PayPalPosting } from './paypal-data';
afterEach(() => vi.unstubAllGlobals());
const posting = (id: string, code: string, amount: string, fee?: string, extra: Partial<PayPalPosting> = {}): PayPalPosting => ({
  transaction_id: id, transaction_event_code: code, transaction_initiation_date: '2026-01-02T00:00:00Z', transaction_status: 'S',
  transaction_updated_date: extra.transaction_updated_date ?? extra.transaction_initiation_date ?? '2026-01-02T00:00:00Z',
  transaction_amount: { currency_code: 'USD', value: amount }, ...(fee ? { fee_amount: { currency_code: 'USD', value: fee } } : {}), ...extra,
});
const response = (rows: PayPalPosting[], extra = {}) => new Response(JSON.stringify({ account_number: 'merchant1', page: 1, total_items: rows.length,
  total_pages: 1, last_refreshed_datetime: '2026-10-10T20:00:00Z', transaction_details: rows.map(transaction_info => ({ transaction_info })), ...extra }));

describe('shared PayPal store attribution', () => {
  it('assigns linked dispute fees and recoveries to their original Shopify store, without charging the other store', () => {
    const rows = [
      posting('sale-a', 'T0006', '100', '-4', { custom_field: '{"shop_id":111}' }),
      posting('sale-b', 'T0006', '200', '-8', { custom_field: '{"shop_id":"222"}' }),
      posting('loss-a', 'T1201', '-100', undefined, { paypal_reference_id_type:'TXN', paypal_reference_id:'sale-a' }),
      posting('fee-a', 'T0114', '-20', undefined, { paypal_reference_id_type:'TXN', paypal_reference_id:'loss-a' }),
      posting('credit-a', 'T1108', '10', undefined, { paypal_reference_id_type:'TXN', paypal_reference_id:'fee-a' }),
      posting('recover-b', 'T1202', '40', undefined, { paypal_reference_id_type:'TXN', paypal_reference_id:'sale-b' }),
    ];
    const a = allocatePayPalPostings(rows, '111'), b = allocatePayPalPostings(rows, '222');
    expect(a.unattributed).toEqual([]); expect(b.unattributed).toEqual([]);
    expect(summarizePayPalPostings(a.postings, {USD:1}).reporting).toMatchObject({processingFees:4,disputeNetLoss:110});
    expect(summarizePayPalPostings(b.postings, {USD:1}).reporting).toMatchObject({processingFees:8,disputeNetLoss:-40});
    expect(new Set([...a.postings, ...b.postings]).size).toBe(rows.length);
  });
  it('excludes ambiguous or missing identifiers and never assigns residual account activity to either profile', () => {
    const rows = [posting('outside-parent','T1201','-50',undefined,{paypal_reference_id_type:'TXN',paypal_reference_id:'outside'}),
      posting('plain','T0006','100','-4',{custom_field:'Shopify'}),
      posting('a','T0006','100','-4',{custom_field:'{"shop_id":111}',paypal_reference_id_type:'TXN',paypal_reference_id:'conflict'}),
      posting('b','T0114','-20',undefined,{custom_field:'{"shop_id":222}',paypal_reference_id_type:'TXN',paypal_reference_id:'conflict'})];
    const result=allocatePayPalPostings(rows,'111');
    expect(result.postings).toEqual([]); expect(result.unattributed).toHaveLength(4); expect(result.conflictingCount).toBe(2);
  });
  it('keeps non-transaction reference types separate and handles repeated IDs and cyclic references safely', () => {
    const rows=[posting('a','T0006','100','-4',{custom_field:'{"shop_id":111}',paypal_reference_id_type:'TXN',paypal_reference_id:'b'}),
      posting('b','T0114','-20',undefined,{paypal_reference_id_type:'TXN',paypal_reference_id:'a'}),
      posting('b','T1108','10'), posting('other','T1201','-50',undefined,{paypal_reference_id_type:'ODR',paypal_reference_id:'a'})];
    const result=allocatePayPalPostings(rows,'111');
    expect(result.postings).toHaveLength(3); expect(result.unattributed.map(r=>r.transaction_id)).toEqual(['other']);
    expect(()=>allocatePayPalPostings(rows,'')).toThrow('verified');
  });
  it('rejects a mismatched Shopify identity before allowing a shared financial binding', async () => {
    const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({shop:{id:111,myshopify_domain:'other.myshopify.com'}})));
    vi.stubGlobal('fetch',fetch);
    await expect(verifyPayPalShopifyIdentity('store.myshopify.com','read-token','2026-07')).rejects.toThrow('does not match');
    fetch.mockResolvedValue(new Response(JSON.stringify({shop:{id:111,myshopify_domain:'store.myshopify.com'}})));
    expect(await verifyPayPalShopifyIdentity('store.myshopify.com','read-token','2026-07')).toBe('111');
  });
});

describe('PayPal money movements', () => {
  it('counts actual principal, fees and partial recoveries once, while excluding dispute holds and cash transfers', () => {
    const result = summarizePayPalPostings([
      posting('sale', 'T0006', '100.00', '-4.00'),
      posting('hold', 'T1110', '-100.00', undefined, { transaction_status: 'P' }),
      posting('hold', 'T1111', '100.00', undefined, { transaction_status: 'D' }),
      posting('loss', 'T1106', '-100.00', '3.00'),
      posting('fee', 'T0114', '-20.00'), posting('return', 'T1108', '10.00', undefined, { paypal_reference_id: 'fee' }),
      posting('recovered', 'T1202', '30.00'), posting('payout', 'T0400', '-500.00', undefined, { transaction_status: undefined }),
      posting('convert', 'T0201', '-96.00'),
    ], { USD: 1 });
    expect(result.byCurrency.USD).toMatchObject({ processingFees: 1, disputeDebits: 100, disputeFees: 20, disputeRecoveries: 30, disputeFeeRecoveries: 10, disputeNetLoss: 80 });
    // The recognized balance postings cost 4 + (100 - 3) + 20 - 10 - 30 = 81.
    expect(result.reporting.processingFees + result.reporting.disputeNetLoss).toBe(81);
    expect(result.unclassifiedCount).toBe(0);
  });
  it('includes a real fee credit without assuming it refunded a dispute fee outside the report', () => {
    const result = summarizePayPalPostings([posting('credit', 'T1108', '20.00', undefined, { paypal_reference_id: 'outside' })], { USD: 1 });
    expect(result.reporting.processingFees).toBe(-20);
    expect(result.reporting.disputeFeeRecoveries).toBe(0);
    expect(result.unmatchedFeeCredits).toBe(1);
  });
  it('preserves native currencies, refund fee credits and reversed-successful payments without adding sales again', () => {
    const result = summarizePayPalPostings([
      posting('sale', 'T0006', '100', '-4', { transaction_status: 'V' }),
      posting('refund', 'T1107', '-25', '1'),
      posting('aud', 'T1201', '-170', undefined, { transaction_amount: { currency_code: 'AUD', value: '-170' } }),
    ], { USD: 1, AUD: 0.5 });
    expect(result.byCurrency.USD.processingFees).toBe(3);
    expect(result.byCurrency.USD.refunds).toBe(25);
    expect(result.byCurrency.AUD.disputeDebits).toBe(170);
    expect(result.reporting.disputeDebits).toBe(85);
    expect(result.fxApproximate).toBe(true);
  });
  it('flags outgoing purchases and unknown adjustments rather than charging already-configured advertising or supplier costs twice', () => {
    const result = summarizePayPalPostings([posting('purchase', 'T0003', '-200'), posting('unknown', 'T1200', '10')], { USD: 1 });
    expect(result.reporting.processingFees + result.reporting.refunds + result.reporting.disputeNetLoss).toBe(0);
    expect(result.reporting.unclassifiedNet).toBe(-190);
    expect(result.outgoingPaymentCount).toBe(1);
    expect(result.unclassifiedCount).toBe(2);
  });
  it('rejects invalid money, duplicate events and missing FX instead of reporting incomplete costs as zero', () => {
    expect(() => summarizePayPalPostings([posting('bad', 'T0006', 'NaN')], { USD: 1 })).toThrow('monetary');
    expect(() => summarizePayPalPostings([posting('same', 'T1201', '-100'), posting('same', 'T1201', '-100')], { USD: 1 })).toThrow('repeated');
    expect(() => summarizePayPalPostings([posting('eur', 'T0114', '-20', undefined, { transaction_amount: { currency_code: 'EUR', value: '-20' } })], { USD: 1 })).toThrow('rate');
  });
});
describe('PayPal reporting access and complete pagination', () => {
  it('requests and caches only a reporting-scoped token, and refuses a broader returned scope', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'read-token', scope: 'https://uri.paypal.com/services/reporting/search/read', token_type: 'Bearer', expires_in: 3600 })));
    vi.stubGlobal('fetch', fetch);
    expect(await getPayPalReportingToken('read-client', 'secret')).toBe('read-token');
    expect(await getPayPalReportingToken('read-client', 'secret')).toBe('read-token');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new URLSearchParams(fetch.mock.calls[0][1].body).get('scope')).toBe('https://uri.paypal.com/services/reporting/search/read');
    fetch.mockResolvedValue(new Response(JSON.stringify({ access_token: 'write-token', scope: 'https://uri.paypal.com/services/payments/refund', token_type: 'Bearer', expires_in: 3600 })));
    await expect(getPayPalReportingToken('other-client', 'secret')).rejects.toThrow('restricted');
  });
  it('reads all pages and 28-day windows, including their shared midnight boundary exactly once', async () => {
    const boundary = posting('boundary', 'T1201', '-10', undefined, { transaction_initiation_date: '2026-01-29T00:00:00Z' });
    const fetch = vi.fn().mockResolvedValueOnce(response([posting('first', 'T0114', '-20')], { total_items: 2, total_pages: 2 }))
      .mockResolvedValueOnce(response([boundary], { page: 2, total_items: 2, total_pages: 2 }))
      .mockResolvedValueOnce(response([boundary]));
    vi.stubGlobal('fetch', fetch);
    const result = await readPayPalPostings('read-token', { fromDate: '2026-01-01', toDate: '2026-02-01' }, 0, 'UTC', 'merchant1');
    expect(result.pageCount).toBe(3);
    expect(result.postings.map(row => row.transaction_id)).toEqual(['first', 'boundary']);
    for (const [, init] of fetch.mock.calls) expect(init.method).toBe('GET');
    expect(new URL(fetch.mock.calls[2][0]).searchParams.get('start_date')).toBe('2026-01-29T00:00:00.000Z');
  });
  it('accepts a documented empty report and flags a recent reporting delay', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([], { transaction_details: undefined, total_pages: 0 })));
    const result = await readPayPalPostings('read-token', { fromDate: '2026-10-10', toDate: '2026-10-10' }, 0, 'UTC', 'merchant1');
    expect(result.postings).toEqual([]);
    expect(result.incompleteRecentPeriod).toBe(true);
  });
  it('uses the reported update date when a hold release retains a previous-year initiation date', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([posting('hold','T1111','100',undefined,{transaction_initiation_date:'2025-12-01T00:00:00Z',transaction_updated_date:'2026-01-02T00:00:00Z',transaction_status:'D'})])));
    const result=await readPayPalPostings('read-token',{fromDate:'2026-01-01',toDate:'2026-01-02'},0,'UTC');
    expect(result.postings).toHaveLength(1);
    expect(summarizePayPalPostings(result.postings,{USD:1}).reporting.disputeNetLoss).toBe(0);
  });
  it('fails on another merchant, missing pages or repeated events', async () => {
    const fetch = vi.fn().mockResolvedValue(response([posting('first', 'T0114', '-20')])); vi.stubGlobal('fetch', fetch);
    const period = { fromDate: '2026-01-01', toDate: '2026-01-02' };
    await expect(readPayPalPostings('read-token', period, 0, 'UTC', 'other')).rejects.toThrow('different account');
    fetch.mockResolvedValue(response([], { total_items: 1 }));
    await expect(readPayPalPostings('read-token', period)).rejects.toThrow('incomplete');
    fetch.mockResolvedValue(response([posting('same', 'T0114', '-20'), posting('same', 'T0114', '-20')]));
    await expect(readPayPalPostings('read-token', period, 0, 'UTC')).rejects.toThrow('repeated');
  });
});
