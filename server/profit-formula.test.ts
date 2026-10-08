import { describe, expect, it } from "vitest";
import { calculateProfitBreakdown } from "./profit-formula";

const baseline = {
  revenue: 200, cogs: 40, shipping: 10, processingFees: 6,
  adSpend: 20, operationalExpenses: 4, refunds: 25,
  disputeValue: 30, disputeFees: 7,
  disputeRecovered: 15, disputeFeesRecovered: 0,
};

describe("operating-profit reconciliation", () => {
  it("subtracts posted principal debits and actual fees, and credits posted recoveries once", () => {
    const result = calculateProfitBreakdown(baseline);
    expect(result).toMatchObject({ totalCosts: 127, netProfit: 73, margin: 36.5 });
    expect(baseline.revenue - result.totalCosts).toBe(result.netProfit);
  });

  it("fully reverses a same-period won dispute without adding a second sale", () => {
    const result = calculateProfitBreakdown({
      revenue: 100, cogs: 20, shipping: 5, processingFees: 3,
      adSpend: 10, operationalExpenses: 2, refunds: 0,
      disputeValue: 100, disputeFees: 15,
      disputeRecovered: 100, disputeFeesRecovered: 15,
    });
    expect(result).toMatchObject({ totalCosts: 40, netProfit: 60 });
  });

  it("keeps a pending chargeback debit, but does not fabricate a won fee refund", () => {
    const result = calculateProfitBreakdown({
      ...baseline, disputeRecovered: 0, disputeFeesRecovered: 0,
    });
    expect(result.netProfit).toBe(58);
  });

  it("accepts a negative refund on a later refund reversal and rejects invalid values", () => {
    const original = calculateProfitBreakdown(baseline);
    expect(calculateProfitBreakdown({ ...baseline, refunds: -25 }).netProfit - original.netProfit).toBe(50);
    expect(() => calculateProfitBreakdown({ ...baseline, processingFees: NaN })).toThrow("processingFees");
  });
});
