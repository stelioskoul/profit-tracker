import { createHash } from 'node:crypto';
import { shopifyDateBounds, type ShopifyDateRange } from './shopify-date';
import type { NativeBalanceTotals } from './shopify-data';

const REPORTING_SCOPE = 'https://uri.paypal.com/services/reporting/search/read';
const API = 'https://api-m.paypal.com';
type Money = { currency_code: string; value: string };
export type PayPalPosting = {
  transaction_id: string; transaction_event_code: string;
  transaction_initiation_date: string; transaction_updated_date?: string; transaction_status?: string;
  transaction_amount: Money; fee_amount?: Money;
  paypal_reference_id?: string; paypal_reference_id_type?: string;
  custom_field?: string;
};
const tokens = new Map<string, { value: string; expires: number }>();

async function request(path: string, init: RequestInit) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(API + path, { ...init, redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (response.status === 429 && attempt < 2) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      continue;
    }
    if (!response.ok) throw new Error(`PayPal reporting request failed (HTTP ${response.status}). Verify live credentials and Transaction Search access.`);
    return response.json();
  }
  throw new Error('PayPal reporting rate limit did not recover');
}

/** The app never requests payment, refund, payout or dispute-editing scopes. */
export async function getPayPalReportingToken(clientId: string, clientSecret: string) {
  const cacheKey = createHash('sha256').update(clientId).update('\0').update(clientSecret).digest('hex');
  const cached = tokens.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value;
  const data = await request('/v1/oauth2/token', { method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: REPORTING_SCOPE }).toString() });
  const scopes = String(data.scope || '').split(/\s+/).filter(Boolean);
  if (scopes.length !== 1 || scopes[0] !== REPORTING_SCOPE || data.token_type?.toLowerCase() !== 'bearer' ||
    typeof data.access_token !== 'string' || !data.access_token || !Number.isFinite(data.expires_in) || data.expires_in <= 60) {
    throw new Error('PayPal did not issue a token restricted to transaction reporting. No connection was saved.');
  }
  tokens.set(cacheKey, { value: data.access_token, expires: Date.now() + (data.expires_in - 60) * 1000 });
  return data.access_token as string;
}

const empty = (): NativeBalanceTotals => ({ processingFees: 0, refunds: 0, disputeDebits: 0, disputeFees: 0,
  disputeRecoveries: 0, disputeFeeRecoveries: 0, disputeProtectionNet: 0, disputeNetLoss: 0, unclassifiedNet: 0 });

/** Bind a shared reporting account to a Shopify identity verified by Shopify. */
export async function verifyPayPalShopifyIdentity(shopDomain: string, accessToken: string, apiVersion: string) {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shopDomain) || !/^\d{4}-\d{2}$/.test(apiVersion)) throw new Error('Invalid Shopify connection');
  const response = await fetch(`https://${shopDomain}/admin/api/${apiVersion}/shop.json`, {
    headers: { 'X-Shopify-Access-Token': accessToken }, redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('Unable to verify the Shopify identity for PayPal allocation');
  const { shop } = await response.json();
  if (shop?.myshopify_domain !== shopDomain || !Number.isSafeInteger(shop.id) || shop.id <= 0) throw new Error('PayPal allocation Shopify identity does not match');
  return String(shop.id);
}

/** No residual account spend or date split is assigned to a shared store. */
export function allocatePayPalPostings(postings: PayPalPosting[], shopId: string) {
  if (!/^[1-9]\d*$/.test(shopId)) throw new Error('A verified Shopify shop ID is required for PayPal allocation');
  const parents = new Map<string, string>(), tags = new Map<string, Set<string>>();
  const root = (id: string): string => {
    let current = id;
    while (parents.has(current)) current = parents.get(current)!;
    let next = id;
    while (parents.has(next)) { const previous = parents.get(next)!; parents.set(next, current); next = previous; }
    return current;
  };
  for (const row of postings) {
    if (!row.transaction_id) throw new Error('PayPal allocation event has no transaction ID');
    if (row.paypal_reference_id_type === 'TXN' && row.paypal_reference_id) {
      const left = root(row.transaction_id), right = root(row.paypal_reference_id);
      if (left !== right) parents.set(left, right);
    }
  }
  for (const row of postings) {
    let value: unknown;
    try { value = JSON.parse(row.custom_field || 'null')?.shop_id; } catch { continue; }
    const id = typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) :
      typeof value === 'string' && /^[1-9]\d*$/.test(value) ? value : undefined;
    if (id) { const key = root(row.transaction_id), owners = tags.get(key) ?? new Set<string>(); owners.add(id); tags.set(key, owners); }
  }
  const allocated: PayPalPosting[] = [], unattributed: PayPalPosting[] = [];
  let otherStoreCount = 0, conflictingCount = 0;
  for (const row of postings) {
    const owners = tags.get(root(row.transaction_id));
    if (!owners?.size || owners.size > 1) { unattributed.push(row); if (owners && owners.size > 1) conflictingCount++; }
    else if (owners.has(shopId)) allocated.push(row);
    else otherStoreCount++;
  }
  return { postings: allocated, unattributed, otherStoreCount, conflictingCount };
}

function cents(money: Money) {
  if (!money || !/^[A-Z]{3}$/.test(money.currency_code) || !/^-?\d+(\.\d{1,2})?$/.test(money.value)) throw new Error('PayPal returned an invalid monetary amount');
  const [whole, fraction = ''] = money.value.replace(/^-/, '').split('.');
  const value = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(value)) throw new Error('PayPal amount exceeds safe monetary precision');
  return money.value.startsWith('-') ? -value : value;
}

export function summarizePayPalPostings(postings: PayPalPosting[], usdRates: Record<string, number>) {
  const byCurrency: Record<string, NativeBalanceTotals> = {}, reporting = empty();
  const seen = new Set<string>(), unknown = new Set<string>();
  let unclassifiedCount = 0, unmatchedFeeCredits = 0, outgoingPaymentCount = 0;
  const add = (currency: string, field: keyof NativeBalanceTotals, value: number) => { (byCurrency[currency] ??= empty())[field] += value; };
  for (const row of postings) {
    const currency = row.transaction_amount?.currency_code, code = row.transaction_event_code;
    const key = `${row.transaction_id}:${code}:${currency}`;
    if (!row.transaction_id || !/^T\d{4}$/.test(code || '') || !Number.isFinite(Date.parse(row.transaction_initiation_date)) || seen.has(key)) throw new Error('PayPal contains an invalid or repeated ledger event');
    seen.add(key);
    const amount = cents(row.transaction_amount), fee = row.fee_amount ? cents(row.fee_amount) : 0;
    const feeCurrency = row.fee_amount?.currency_code || currency;
    const transfer = /^(T02|T03|T04|T07|T13|T15|T20|T21)/.test(code) || ['T1110', 'T1111', 'T1105'].includes(code);
    if (transfer) { if (fee) add(feeCurrency, 'processingFees', -fee); continue; }
    const completed = ['S', 'V'].includes(row.transaction_status || '');
    const incoming = /^T00/.test(code) && amount >= 0;
    const disputeFee = ['T0106', 'T0114'].includes(code);
    const feeCredit = ['T1108', 'T1109'].includes(code);
    let field: keyof NativeBalanceTotals | undefined, principal = 0;
    if (completed && incoming) { /* Shopify supplies captured revenue; only the fee is added. */ }
    else if (completed && disputeFee) { field = 'disputeFees'; principal = -amount; }
    else if (completed && /^T01/.test(code)) { field = 'processingFees'; principal = -amount; }
    else if (completed && feeCredit) {
      // A reference can point to a fee outside this period. Its credit still
      // reduces total costs, but a dispute-fee return must not be invented.
      const original = postings.find(other => other.transaction_id === row.paypal_reference_id &&
        ['T0106', 'T0114'].includes(other.transaction_event_code) && other.transaction_amount.currency_code === currency);
      field = original ? 'disputeFeeRecoveries' : 'processingFees';
      principal = original ? amount : -amount;
      if (!original) unmatchedFeeCredits++;
    }
    else if (completed && ['T1106', 'T1201', 'T1207'].includes(code)) { field = 'disputeDebits'; principal = -amount; }
    else if (completed && ['T1202', 'T1205', 'T1208'].includes(code)) { field = 'disputeRecoveries'; principal = amount; }
    else if (completed && ['T1107', 'T1120', 'T1116', 'T1118'].includes(code) && amount <= 0) { field = 'refunds'; principal = -amount; }
    else {
      add(currency, 'unclassifiedNet', amount);
      if (fee) add(feeCurrency, 'unclassifiedNet', fee);
      unknown.add(code); unclassifiedCount++;
      if (/^T00/.test(code) && amount < 0) outgoingPaymentCount++;
      continue;
    }
    if (field) add(currency, field, principal);
    if (fee) add(feeCurrency, 'processingFees', -fee);
    // Keep a visible currency row even if its only posting is a fee-free sale.
    byCurrency[currency] ??= empty();
  }
  for (const [currency, native] of Object.entries(byCurrency)) {
    const rate = usdRates[currency];
    if (!Number.isFinite(rate) || rate <= 0 || (currency === 'USD' && rate !== 1)) throw new Error(`No verified reporting rate for PayPal ${currency}`);
    for (const field of Object.keys(native) as (keyof NativeBalanceTotals)[]) {
      native[field] /= 100;
      reporting[field] += Math.round(native[field] * rate * 100) / 100;
    }
    native.disputeNetLoss = Math.round((native.disputeDebits + native.disputeFees - native.disputeRecoveries - native.disputeFeeRecoveries) * 100) / 100;
  }
  for (const field of Object.keys(reporting) as (keyof NativeBalanceTotals)[]) reporting[field] = Math.round(reporting[field] * 100) / 100;
  reporting.disputeNetLoss = Math.round((reporting.disputeDebits + reporting.disputeFees - reporting.disputeRecoveries - reporting.disputeFeeRecoveries) * 100) / 100;
  return { byCurrency, reporting, unclassifiedCount, unclassifiedTypes: Array.from(unknown),
    unmatchedFeeCredits, outgoingPaymentCount, fxApproximate: Object.keys(byCurrency).some(currency => currency !== 'USD') };
}

export async function readPayPalPostings(token: string, period: ShopifyDateRange, offset = -300, timeZone?: string | null, expectedAccount?: string) {
  const { start, end } = shopifyDateBounds(period, offset, timeZone);
  const postings: PayPalPosting[] = [], seen = new Set<string>();
  let accountNumber = expectedAccount, pageCount = 0, availableThrough = Infinity;
  for (let from = start; from < end; from += 28 * 86400000) {
    const until = Math.min(from + 28 * 86400000, end);
    let total: number | undefined, count = 0;
    for (let page = 1; ; page++) {
      // Query the next boundary inclusively, then retain a half-open window.
      // This avoids gaps when PayPal truncates fractional seconds.
      const params = new URLSearchParams({ start_date: new Date(from).toISOString(), end_date: new Date(until).toISOString(),
        fields: 'transaction_info', balance_affecting_records_only: 'Y', page_size: '500', page: String(page) });
      const data = await request(`/v1/reporting/transactions?${params}`, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
      const rows = data.transaction_details ?? (data.total_items === 0 ? [] : undefined);
      if (!Array.isArray(rows) || !Number.isSafeInteger(data.total_items) || data.total_items < 0 ||
        !Number.isSafeInteger(data.total_pages) || data.total_pages < 0 || data.page !== page ||
        !/^[A-Za-z0-9]+$/.test(data.account_number || '')) throw new Error('PayPal returned incomplete reporting pages');
      if (accountNumber && accountNumber !== data.account_number) throw new Error('PayPal reports belong to a different account');
      accountNumber = data.account_number;
      const refreshed = Date.parse(data.last_refreshed_datetime);
      if (!Number.isFinite(refreshed)) throw new Error('PayPal reporting availability is unknown');
      availableThrough = Math.min(availableThrough, refreshed);
      total ??= data.total_items;
      if (total !== data.total_items) throw new Error('PayPal reporting changed during pagination; refresh again');
      count += rows.length; pageCount++;
      for (const { transaction_info: row } of rows) {
        // Reporting includes event updates: a hold-release event can retain
        // the old hold's initiation date. Validate the reporting update date.
        const when = Date.parse(row?.transaction_updated_date);
        if (!Number.isFinite(when) || when < from || when > until) throw new Error('PayPal returned a posting outside its requested window');
        if (when === until) continue;
        const key = `${row.transaction_id}:${row.transaction_event_code}:${row.transaction_amount?.currency_code}`;
        if (seen.has(key)) throw new Error('PayPal repeated a ledger event across pages');
        seen.add(key); postings.push(row);
      }
      if (page >= data.total_pages) {
        if (count !== total) throw new Error('PayPal reporting pagination is incomplete');
        break;
      }
      if (!rows.length) throw new Error('PayPal returned an empty page before the end of its ledger');
    }
  }
  return { postings, accountNumber: accountNumber!, pageCount, availableThrough: new Date(availableThrough).toISOString(), incompleteRecentPeriod: availableThrough < Math.min(end - 1000, Date.now()) };
}

export async function verifyPayPalConnection(clientId: string, clientSecret: string) {
  const token = await getPayPalReportingToken(clientId, clientSecret);
  const today = new Date().toISOString().slice(0, 10);
  const ledger = await readPayPalPostings(token, { fromDate: today, toDate: today }, 0, 'UTC');
  return { accountNumber: ledger.accountNumber };
}
