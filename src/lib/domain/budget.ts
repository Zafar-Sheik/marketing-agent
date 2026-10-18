import { splitByShares } from './money';

export type BudgetInput = {
  /** Whole-month paid budget the user set for this goal. */
  monthBudgetCents: number;
  /** Budget already committed to other campaigns this month. */
  committedCents: number;
  /** What the plan wants to spend on this placement. */
  plannedSpendCents: number;
  /** Days the ad will run (>= 1). */
  flightDays: number;
  /** Smallest daily ad group budget the ad account accepts, in account currency cents. */
  minDailyCents?: number;
};

export type BudgetDecision =
  | { ok: true; budgetCents: number; dailyBudgetCents: number; flightDays: number; cappedByRemaining: boolean }
  | { ok: false; reason: string; remainingCents: number };

/**
 * Budget for one paid placement. Never exceeds what is left of the month's budget,
 * paces it evenly across the flight, and shortens the flight rather than going below
 * the account's daily minimum.
 */
export function calculatePlacementBudget(input: BudgetInput): BudgetDecision {
  const { monthBudgetCents, committedCents, plannedSpendCents, minDailyCents = 0 } = input;
  if (input.flightDays < 1) throw new Error('flightDays must be >= 1');
  const remainingCents = Math.max(0, monthBudgetCents - committedCents);
  const budgetCents = Math.min(plannedSpendCents, remainingCents);
  if (budgetCents <= 0) {
    return { ok: false, reason: 'The monthly ad budget is fully committed.', remainingCents };
  }
  let flightDays = Math.floor(input.flightDays);
  if (minDailyCents > 0) flightDays = Math.min(flightDays, Math.floor(budgetCents / minDailyCents));
  if (flightDays < 1) {
    return {
      ok: false,
      reason: `Only ${budgetCents} cents available, below the ${minDailyCents} cents daily minimum.`,
      remainingCents,
    };
  }
  const dailyBudgetCents = Math.floor(budgetCents / flightDays);
  return {
    ok: true,
    budgetCents: dailyBudgetCents * flightDays,
    dailyBudgetCents,
    flightDays,
    cappedByRemaining: budgetCents < plannedSpendCents,
  };
}

/** Turn the plan's objective shares into cents that add up exactly to the month budget. */
export function allocateByObjective(monthBudgetCents: number, allocation: Record<string, number>) {
  return splitByShares(monthBudgetCents, allocation);
}

/**
 * Scale paid plan items down proportionally if the model overspent the budget,
 * so a plan can never be approved above the cap.
 */
export function fitPlannedSpend<T extends { plannedSpendCents: number; isPaid: boolean }>(
  items: T[],
  monthBudgetCents: number,
): T[] {
  const paid = items.filter((i) => i.isPaid && i.plannedSpendCents > 0);
  const total = paid.reduce((s, i) => s + i.plannedSpendCents, 0);
  if (total <= monthBudgetCents) return items.map((i) => (i.isPaid ? i : { ...i, plannedSpendCents: 0 }));
  const scaled = splitByShares(
    monthBudgetCents,
    Object.fromEntries(paid.map((i, idx) => [String(idx), i.plannedSpendCents])),
  );
  let idx = 0;
  return items.map((i) => {
    if (!i.isPaid) return { ...i, plannedSpendCents: 0 };
    if (i.plannedSpendCents <= 0) return i;
    return { ...i, plannedSpendCents: scaled[String(idx++)] };
  });
}

/** Sum of paid budgets must stay within the month cap. */
export function assertWithinMonthCap(monthBudgetCents: number, campaignBudgetsCents: number[]) {
  const total = campaignBudgetsCents.reduce((s, c) => s + c, 0);
  if (total > monthBudgetCents) {
    throw new BudgetCapError(total, monthBudgetCents);
  }
}

export class BudgetCapError extends Error {
  constructor(
    public readonly requestedCents: number,
    public readonly capCents: number,
  ) {
    super(`Campaign budgets (${requestedCents}) exceed the monthly cap (${capCents}).`);
    this.name = 'BudgetCapError';
  }
}
