import { validateDateRange, type ShopifyDateRange } from './shopify-date';

export type AdSpendDates = { spendFromDate?: string | null; spendToDate?: string | null };

/** Optional dates belong to one store's ad-account connection. */
export function allocatedAdPeriod(period: ShopifyDateRange, dates: AdSpendDates): ShopifyDateRange | null {
  validateDateRange(period);
  const { spendFromDate: from, spendToDate: to } = dates;
  if (from || to) validateDateRange({ fromDate: from || to!, toDate: to || from! });
  const fromDate = from && from > period.fromDate ? from : period.fromDate;
  const toDate = to && to < period.toDate ? to : period.toDate;
  return fromDate <= toDate ? { fromDate, toDate } : null;
}

export function adPeriodsOverlap(first: ShopifyDateRange, second: ShopifyDateRange | null): boolean {
  return !!second && first.fromDate <= second.toDate && second.fromDate <= first.toDate;
}
