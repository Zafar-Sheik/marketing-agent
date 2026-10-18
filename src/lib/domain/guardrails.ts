export type OptimisationAction =
  | { type: 'set_daily_budget'; adGroupId: string; dailyBudgetCents: number; reason: string }
  | { type: 'pause_ad'; adId: string; reason: string }
  | { type: 'enable_ad'; adId: string; reason: string }
  | { type: 'request_variant'; creativeId: string; brief: string; reason: string };

export type GuardrailContext = {
  /** Current daily budget per ad group. */
  currentDailyBudgets: Record<string, number>;
  /** Max relative change per ad group per day, e.g. 30 for ±30%. */
  maxChangePct: number;
  /** Money left this month and days left (including today). */
  remainingMonthCents: number;
  daysLeft: number;
  autopilot: boolean;
};

export type GuardrailResult = {
  autoApply: OptimisationAction[];
  needsApproval: { action: OptimisationAction; why: string }[];
  rejected: { action: OptimisationAction; why: string }[];
};

/**
 * Splits the optimiser's proposals into what may run unattended, what needs a human,
 * and what is never allowed (overspending the month).
 */
export function applyGuardrails(actions: OptimisationAction[], ctx: GuardrailContext): GuardrailResult {
  const result: GuardrailResult = { autoApply: [], needsApproval: [], rejected: [] };
  const projected = { ...ctx.currentDailyBudgets };

  for (const action of actions) {
    if (action.type !== 'set_daily_budget') {
      // Pausing is always safe; enabling or new creative spends money -> approval unless autopilot.
      if (action.type === 'pause_ad' || ctx.autopilot) result.autoApply.push(action);
      else result.needsApproval.push({ action, why: 'Re-enabling ads or new variants needs approval.' });
      continue;
    }
    const current = ctx.currentDailyBudgets[action.adGroupId];
    if (current === undefined) {
      result.rejected.push({ action, why: 'Unknown ad group.' });
      continue;
    }
    if (action.dailyBudgetCents < 0) {
      result.rejected.push({ action, why: 'Budget cannot be negative.' });
      continue;
    }
    const nextProjected = { ...projected, [action.adGroupId]: action.dailyBudgetCents };
    const dailyTotal = Object.values(nextProjected).reduce((s, v) => s + v, 0);
    if (dailyTotal * ctx.daysLeft > ctx.remainingMonthCents) {
      result.rejected.push({ action, why: 'Would spend more than what is left of the monthly budget.' });
      continue;
    }
    projected[action.adGroupId] = action.dailyBudgetCents;
    const changePct = current === 0 ? Infinity : (Math.abs(action.dailyBudgetCents - current) / current) * 100;
    if (action.dailyBudgetCents < current || changePct <= ctx.maxChangePct || ctx.autopilot) {
      result.autoApply.push(action);
    } else {
      result.needsApproval.push({
        action,
        why: `Budget increase of ${Math.round(changePct)}% exceeds the ${ctx.maxChangePct}% daily limit.`,
      });
    }
  }
  return result;
}
