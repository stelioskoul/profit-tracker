import { describe, expect, it } from "vitest";
import { calculateOperationalExpensesForPeriod } from "./profit-calculator";

const date = (value: string) => new Date(`${value}T00:00:00Z`);

describe("operational expense posting", () => {
  it("charges Jan-31 monthly expenses on Feb-28 and Mar-31, not Mar-03", () => {
    const expense = [{ type: "monthly" as const, amount: 5, startDate: date("2026-01-31") }];
    expect(calculateOperationalExpensesForPeriod(expense, date("2026-02-01"), date("2026-02-28"))).toBe(5);
    expect(calculateOperationalExpensesForPeriod(expense, date("2026-03-01"), date("2026-03-31"))).toBe(5);
  });

  it("honors an expense end date without erasing past occurrences", () => {
    const expense = [{ type: "monthly" as const, amount: 7, startDate: date("2026-01-31"), endDate: date("2026-02-28") }];
    expect(calculateOperationalExpensesForPeriod(expense, date("2026-01-01"), date("2026-03-31"))).toBe(14);
  });

  it("clamps an annual February-29 anniversary to February-28 in a non-leap year", () => {
    const expense = [{ type: "yearly" as const, amount: 9, startDate: date("2024-02-29") }];
    expect(calculateOperationalExpensesForPeriod(expense, date("2025-02-01"), date("2025-02-28"))).toBe(9);
  });

  it("includes one-time expenses only on their UTC calendar day", () => {
    const expense = [{ type: "one_time" as const, amount: 3, date: date("2026-10-01") }];
    expect(calculateOperationalExpensesForPeriod(expense, date("2026-10-01"), date("2026-10-01"))).toBe(3);
    expect(calculateOperationalExpensesForPeriod(expense, date("2026-10-02"), date("2026-10-02"))).toBe(0);
  });
});
