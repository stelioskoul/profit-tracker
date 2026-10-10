import { shopifyDateBounds, type ShopifyDateRange } from './shopify-date';
import type { NativeBalanceTotals } from './shopify-data';

const API_VERSION = '2026-09-30.endive';
type StripeObject = Record<string, any>;
export interface StripePosting {
  id: string; created: number; amount: number; fee: number; net: number;
  currency: string; reporting_category: string; type: string; source?: StripeObject | string | null;
}

// This module deliberately exposes only GET requests. Provider errors must
// never include request headers, API keys, or customer evidence in responses.
async function stripeGet(key: string, path: string, params: Record<string, string> = {}): Promise<StripeObject> {
  const url = new URL(`https://api.stripe.com/v1/${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${key}`, 'Stripe-Version': API_VERSION } });
    if (response.status === 429 && attempt < 2) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      continue;
    }
    if (!response.ok) throw new Error(`Stripe read failed (HTTP ${response.status}). Check the restricted key's read permissions.`);
    const data = await response.json();
    if (!data || typeof data !== 'object') throw new Error('Stripe returned an invalid response');
    return data;
  }
  throw new Error('Stripe rate limit did not recover');
}

export async function verifyStripeConnection(key: string, shopDomain: string) {
  if (!/^rk_live_[A-Za-z0-9]+$/.test(key)) throw new Error('Use a live restricted Stripe key with read permissions only');
  const account = await stripeGet(key, 'account');
  if (!/^acct_[A-Za-z0-9]+$/.test(account.id)) throw new Error('Stripe account identity is missing');
  const charges = await stripeGet(key, 'charges', { limit: '100' });
  if (!Array.isArray(charges.data)) throw new Error('Stripe charge access could not be verified');
  const captured = charges.data.filter((c: StripeObject) => c.paid && c.captured);
  if (!captured.length || captured.some((c: StripeObject) => c.livemode !== true || c.metadata?.shopify_shop_domain !== shopDomain)) {
    throw new Error('Use the separate Stripe account dedicated to this Shopify store. Captured payments must identify the same Shopify domain.');
  }
  await stripeGet(key, 'balance_transactions', { limit: '1', 'expand[]': 'data.source' });
  await stripeGet(key, 'disputes', { limit: '1' });
  return { accountId: account.id as string, accountName: String(account.business_profile?.name || account.settings?.dashboard?.display_name || account.id) };
}

const emptyNative = (): NativeBalanceTotals => ({ processingFees: 0, refunds: 0, disputeDebits: 0,
  disputeFees: 0, disputeRecoveries: 0, disputeFeeRecoveries: 0, disputeProtectionNet: 0,
  disputeNetLoss: 0, unclassifiedNet: 0 });

export function summarizeStripePostings(postings: StripePosting[], rate: number) {
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Invalid Stripe reporting exchange rate');
  const byCurrency: Record<string, NativeBalanceTotals> = {};
  const seen = new Set<string>(), unknown = new Set<string>();
  const reporting = emptyNative();
  let unclassifiedCount = 0, fxApproximate = false;
  for (const row of postings) {
    if (!row.id || seen.has(row.id)) throw new Error('Stripe ledger contains a duplicate or missing transaction ID');
    seen.add(row.id);
    if (![row.amount, row.fee, row.net, row.created].every(Number.isSafeInteger) || row.amount - row.fee !== row.net) {
      throw new Error('Stripe ledger has invalid minor units or an inconsistent net amount');
    }
    const currency = row.currency?.toUpperCase();
    if (!['USD', 'EUR'].includes(currency)) throw new Error(`Unsupported Stripe payout currency: ${currency}`);
    const native = byCurrency[currency] ??= emptyNative();
    const delta = emptyNative();
    switch (row.reporting_category) {
      // Shopify already supplies captured sales. Never add Stripe charge
      // principal as a second sale, or uncaptured reversals as real refunds.
      case 'charge': case 'charge_failure': case 'partial_capture_reversal': delta.processingFees = row.fee; break;
      case 'fee': delta.processingFees = -row.net; break;
      case 'refund': case 'refund_failure': delta.refunds = -row.amount; delta.processingFees = row.fee; break;
      case 'dispute':
        if (row.amount > 0) throw new Error('Stripe dispute debit has an invalid sign');
        delta.disputeDebits = -row.amount; delta.disputeFees = row.fee; break;
      case 'dispute_reversal':
        if (row.amount < 0) throw new Error('Stripe dispute recovery has an invalid sign');
        delta.disputeRecoveries = row.amount; delta.disputeFeeRecoveries = -row.fee; break;
      case 'payout': case 'payout_reversal': case 'risk_reserved_funds': case 'connect_reserved_funds': break;
      default: delta.unclassifiedNet = row.net; unknown.add(row.reporting_category || row.type || 'missing'); unclassifiedCount++;
    }
    for (const field of Object.keys(delta) as (keyof NativeBalanceTotals)[]) {
      // Accumulate in integer minor units, then convert once below. A fee
      // refund is signed; a won case does not manufacture a fee credit.
      native[field] += delta[field];
    }
  }
  for (const [currency, native] of Object.entries(byCurrency)) {
    for (const field of Object.keys(native) as (keyof NativeBalanceTotals)[]) {
      native[field] /= 100;
      reporting[field] += Math.round(native[field] * (currency === 'EUR' ? rate : 1) * 100) / 100;
    }
    native.disputeNetLoss = Math.round((native.disputeDebits + native.disputeFees - native.disputeRecoveries - native.disputeFeeRecoveries) * 100) / 100;
    if (currency === 'EUR') fxApproximate = true;
  }
  for (const field of Object.keys(reporting) as (keyof NativeBalanceTotals)[]) reporting[field] = Math.round(reporting[field] * 100) / 100;
  reporting.disputeNetLoss = Math.round((reporting.disputeDebits + reporting.disputeFees - reporting.disputeRecoveries - reporting.disputeFeeRecoveries) * 100) / 100;
  return { byCurrency, reporting, unclassifiedCount, unclassifiedTypes: Array.from(unknown), fxApproximate, transactionCount: postings.length };
}

export async function fetchStripeLedger(key: string, shopDomain: string, period: ShopifyDateRange,
  rate: number, offset = -300, timeZone?: string | null) {
  const { start, end } = shopifyDateBounds(period, offset, timeZone);
  const params: Record<string, string> = { limit: '100', 'created[gte]': String(start / 1000),
    'created[lt]': String(end / 1000), 'expand[]': 'data.source' };
  const postings: StripePosting[] = [], seen = new Set<string>();
  const chargeCache = new Map<string, Promise<void>>();
  const assertCharge = async (source: StripeObject | string | undefined) => {
    if (!source || (typeof source !== 'string' && typeof source !== 'object')) throw new Error('Stripe payment cannot be attributed to a charge');
    const id = typeof source === 'string' ? source : source.id;
    if (!/^ch_[A-Za-z0-9]+$/.test(id ?? '')) throw new Error('Stripe payment cannot be attributed to a charge');
    if (!chargeCache.has(id)) chargeCache.set(id, (async () => {
      const charge = typeof source === 'object' ? source : await stripeGet(key, `charges/${id}`);
      if (charge.livemode !== true || charge.metadata?.shopify_shop_domain !== shopDomain) {
        throw new Error('Stripe contains an unattributed payment or a payment from another Shopify store. Profit cannot be verified.');
      }
    })());
    await chargeCache.get(id);
  };
  let pages = 0;
  while (true) {
    const data = await stripeGet(key, 'balance_transactions', params);
    if (!Array.isArray(data.data) || typeof data.has_more !== 'boolean') throw new Error('Stripe pagination is invalid');
    pages++;
    for (const row of data.data as StripePosting[]) {
      if (seen.has(row.id)) throw new Error('Stripe cursor repeated a transaction');
      seen.add(row.id);
      if (!Number.isSafeInteger(row.created) || row.created * 1000 < start || row.created * 1000 >= end) throw new Error('Stripe returned a posting outside the requested period');
      if (['charge', 'refund', 'refund_failure', 'dispute', 'dispute_reversal', 'partial_capture_reversal', 'charge_failure'].includes(row.reporting_category)) {
        let source = row.source;
        if (typeof source === 'string') {
          const path = source.startsWith('ch_') ? 'charges' : source.startsWith('du_') ? 'disputes' : source.startsWith('re_') ? 'refunds' : null;
          if (!path) throw new Error('Stripe posting has an unknown payment source');
          source = await stripeGet(key, `${path}/${source}`);
        }
        if (!source || source.object === undefined) throw new Error('Stripe payment source is missing');
        await assertCharge(source.object === 'charge' ? source : source.charge);
      }
      postings.push(row);
    }
    if (!data.has_more) break;
    if (!data.data.length) throw new Error('Stripe has an empty incomplete page');
    params.starting_after = data.data[data.data.length - 1].id;
  }
  return { ...summarizeStripePostings(postings, rate), pageCount: pages };
}
