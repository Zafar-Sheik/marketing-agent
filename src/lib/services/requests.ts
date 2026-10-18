import { and, eq, inArray } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import { monthStart } from '@/lib/domain/dates';
import { localTime } from '@/lib/workflows/monthly-plan';
import { startWorkflow } from '@/lib/engine/runs';

/**
 * A weekly ask. If this month's plan is already approved, it's slotted in and produced now;
 * otherwise the next plan absorbs it.
 */
export async function fulfilRequest(db: Db, requestId: string) {
  const [request] = await db.select().from(schema.contentRequests).where(eq(schema.contentRequests.id, requestId));
  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, request.companyId));
  const [row] = await db
    .select({ plan: schema.marketingPlans })
    .from(schema.marketingPlans)
    .innerJoin(schema.monthlyGoals, eq(schema.monthlyGoals.id, schema.marketingPlans.monthlyGoalId))
    .where(
      and(
        eq(schema.marketingPlans.companyId, request.companyId),
        eq(schema.monthlyGoals.month, monthStart(request.weekStart < monthStart(new Date()) ? new Date() : request.weekStart)),
        inArray(schema.marketingPlans.status, ['approved', 'active']),
      ),
    )
    .limit(1);
  if (!row) return { produced: false as const };

  const preferred = localTime(request.weekStart, '12:00', company.timezone);
  const scheduledFor = preferred > new Date() ? preferred : new Date(Date.now() + 2 * 3600_000);
  const [item] = await db
    .insert(schema.planItems)
    .values({
      marketingPlanId: row.plan.id,
      contentRequestId: request.id,
      scheduledFor,
      format: request.format,
      pillar: 'Client request',
      objective: request.isPaid ? 'traffic' : 'awareness',
      brief: request.prompt,
      isPaid: request.isPaid,
      plannedSpendCents: 0,
    })
    .returning();
  const [creative] = await db
    .insert(schema.creatives)
    .values({ companyId: request.companyId, planItemId: item.id, contentRequestId: request.id, format: request.format })
    .returning();
  await db.update(schema.contentRequests).set({ status: 'in_production', marketingPlanId: row.plan.id }).where(eq(schema.contentRequests.id, request.id));
  await startWorkflow('creative-production', { companyId: request.companyId, subjectType: 'creative', subjectId: creative.id, idempotencyKey: `produce:${item.id}` });
  return { produced: true as const, creativeId: creative.id };
}
