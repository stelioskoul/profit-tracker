/**
 * Operating profit for the selected store-local reporting period.
 * Sales/COGS/shipping: orders created during the period.
 * Payment fees/refunds/dispute debits and credits: Shopify Payments postings
 * processed during the period, regardless of their original order date.
 * This is an operational dashboard measure, not GAAP revenue or bank payouts.
 */
export interface ProfitComponents {
  revenue: number;
  cogs: number;
  shipping: number;
  processingFees: number;
  adSpend: number;
  operationalExpenses: number;
  refunds: number;
  disputeValue: number;
  disputeFees: number;
  disputeRecovered: number;
  disputeFeesRecovered: number;
}

export function calculateProfitBreakdown(values: ProfitComponents): {
  totalCosts: number;
  netProfit: number;
  margin: number;
} {
  for (const [name, amount] of Object.entries(values)) {
    if (!Number.isFinite(amount)) throw new Error(`Cannot calculate profit: ${name} is not a finite amount`);
  }
  const cents = (value: number) => Math.round(value * 100);
  const costCents = cents(values.cogs) + cents(values.shipping) +
    cents(values.processingFees) + cents(values.adSpend) +
    cents(values.operationalExpenses) + cents(values.refunds) +
    cents(values.disputeValue) + cents(values.disputeFees) -
    cents(values.disputeRecovered) - cents(values.disputeFeesRecovered);
  const profitCents = cents(values.revenue) - costCents;
  return {
    totalCosts: costCents / 100,
    netProfit: profitCents / 100,
    margin: values.revenue > 0 ? (profitCents / 100) / values.revenue * 100 : 0,
  };
}
