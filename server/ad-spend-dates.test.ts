import { describe, expect, it } from 'vitest';
import { allocatedAdPeriod, adPeriodsOverlap } from './ad-spend-dates';

describe('optional advertising date allocation', () => {
  const period = { fromDate: '2026-01-01', toDate: '2026-10-10' };
  it('splits a transition date without overlapping or dropping a day', () => {
    const old = allocatedAdPeriod(period, { spendToDate: '2026-08-31' })!;
    const current = allocatedAdPeriod(period, { spendFromDate: '2026-09-01' })!;
    expect(old).toEqual({ fromDate: '2026-01-01', toDate: '2026-08-31' });
    expect(current).toEqual({ fromDate: '2026-09-01', toDate: '2026-10-10' });
    expect(adPeriodsOverlap(old, current)).toBe(false);
    expect(allocatedAdPeriod({fromDate:'2026-09-01',toDate:'2026-09-01'}, {spendFromDate:'2026-09-01'})).not.toBeNull();
    expect(allocatedAdPeriod({fromDate:'2026-09-01',toDate:'2026-09-01'}, {spendToDate:'2026-08-31'})).toBeNull();
  });
  it('leaves unrelated or newly created connections unchanged and still flags overlapping ranges', () => {
    expect(allocatedAdPeriod(period, {})).toEqual(period);
    expect(allocatedAdPeriod(period, {spendFromDate:null,spendToDate:null})).toEqual(period);
    expect(adPeriodsOverlap(period, allocatedAdPeriod(period, {spendFromDate:'2026-09-01'}))).toBe(true);
  });
  it('rejects invalid calendar dates instead of silently dropping advertising costs', () => {
    expect(()=>allocatedAdPeriod(period, {spendToDate:'2026-02-30'})).toThrow('valid');
    expect(()=>allocatedAdPeriod(period, {spendFromDate:'2026-09-01',spendToDate:'2026-08-31'})).toThrow('after');
  });
});
