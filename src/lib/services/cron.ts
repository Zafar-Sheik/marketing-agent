import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import { addDays, monthStart, toIsoDate } from '@/lib/domain/dates';
import { startWorkflow } from '@/lib/engine/runs';
import { scheduleProduction } from './transitions';

export async function runCron(job: 'produce' | 'optimise' | 'monthly-reports', now = new Date()) {
  const d = await db();
  const today = toIsoDate(now);
  if (job === 'produce') {
    return { started: (await scheduleProduction(d)).length };
  }
  if (job === 'optimise') {
    const companies = await d
      .selectDistinct({ id: schema.adCampaigns.companyId })
      .from(schema.adCampaigns)
      .where(inArray(schema.adCampaigns.status, ['active', 'paused']));
    for (const c of companies) {
      await startWorkflow('optimise', { companyId: c.id, subjectType: 'company', subjectId: c.id, idempotencyKey: `optimise:${c.id}:${today}` });
    }
    return { started: companies.length };
  }
  // monthly-reports: on any day, report last month for companies that had goals and have no report yet.
  const lastMonth = monthStart(addDays(monthStart(today), -1));
  const goals = await d
    .select({ companyId: schema.monthlyGoals.companyId })
    .from(schema.monthlyGoals)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.monthlyGoals.companyId))
    .where(and(eq(schema.monthlyGoals.month, lastMonth), eq(schema.companies.status, 'active')));
  for (const g of goals) {
    await startWorkflow('monthly-report', {
      companyId: g.companyId,
      subjectType: 'company',
      subjectId: g.companyId,
      input: { month: lastMonth },
      idempotencyKey: `report:${g.companyId}:${lastMonth}`,
    });
  }
  return { started: goals.length };
}
