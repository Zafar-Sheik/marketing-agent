import Link from 'next/link';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { schema } from '@/db';
import { monthStart, formatMonth } from '@/lib/domain/dates';
import { formatMoney } from '@/lib/domain/money';
import { pendingApprovals } from '@/lib/queries';
import { latestPlanForGoal } from '@/lib/agents/context';
import { ApprovalList } from '@/components/app/approval-list';
import { AutoRefresh, RunProgress } from '@/components/app/live';
import { Badge, Card, CardTitle, Empty, LinkButton, Stat } from '@/components/ui/primitives';
import { RUN_STEPS } from '@/lib/run-labels';
import { getCompany } from './data';

export default async function CompanyOverview({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { company, db, workspace } = await getCompany(slug);
  const month = monthStart(new Date());
  const [goal] = await db.select().from(schema.monthlyGoals).where(and(eq(schema.monthlyGoals.companyId, company.id), eq(schema.monthlyGoals.month, month)));
  const plan = goal ? await latestPlanForGoal(db, goal.id) : undefined;
  const [training] = await db
    .select()
    .from(schema.agentRuns)
    .where(and(eq(schema.agentRuns.companyId, company.id), eq(schema.agentRuns.workflow, 'brand-training')))
    .orderBy(desc(schema.agentRuns.createdAt))
    .limit(1);
  const [{ spent }] = await db
    .select({ spent: sql<number>`coalesce(sum(${schema.adMetricsDaily.spendCents}), 0)::bigint` })
    .from(schema.adMetricsDaily)
    .innerJoin(schema.ads, eq(schema.ads.id, schema.adMetricsDaily.adId))
    .innerJoin(schema.creatives, eq(schema.creatives.id, schema.ads.creativeId))
    .where(and(eq(schema.creatives.companyId, company.id), gte(schema.adMetricsDaily.date, month)));
  const upcoming = plan
    ? await db
        .select({ item: schema.planItems, creative: schema.creatives })
        .from(schema.planItems)
        .leftJoin(schema.creatives, eq(schema.creatives.planItemId, schema.planItems.id))
        .where(and(eq(schema.planItems.marketingPlanId, plan.id), gte(schema.planItems.scheduledFor, new Date(Date.now() - 86_400_000))))
        .orderBy(schema.planItems.scheduledFor)
        .limit(8)
    : [];
  const runs = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.companyId, company.id)).orderBy(desc(schema.agentRuns.createdAt)).limit(8);
  const approvals = await pendingApprovals(db, workspace.id, company.id);
  const busy = runs.some((r) => r.status === 'queued' || r.status === 'running');
  const budget = goal?.adBudgetCents ?? company.monthlyAdBudgetCents;

  return (
    <div className="space-y-6">
      <AutoRefresh active={busy} />
      {company.status === 'draft' && !training && (
        <Card className="border-accent/40">
          <CardTitle>Finish setting up {company.name}</CardTitle>
          <p className="mb-4 text-sm text-muted">Upload past work, connect TikTok and train the agents on this brand.</p>
          <LinkButton href={`/companies/${company.slug}/onboarding`}>Continue setup</LinkButton>
        </Card>
      )}
      {training && (training.status === 'queued' || training.status === 'running') && (
        <Card>
          <CardTitle>Learning the brand</CardTitle>
          <RunProgress runId={training.id} steps={[...RUN_STEPS['brand-training']]} />
        </Card>
      )}
      {training?.status === 'failed' && (
        <Card className="border-bad/40">
          <CardTitle>Brand training failed</CardTitle>
          <p className="text-sm text-bad">{training.error}</p>
          <LinkButton href={`/companies/${company.slug}/onboarding`} variant="ghost" className="mt-3">
            Fix and retry
          </LinkButton>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label={`${formatMonth(month)} plan`} value={plan ? <Badge status={plan.status} /> : '—'} hint={goal ? 'goals set' : 'no goals yet'} />
        <Stat label="Ad spend" value={formatMoney(Number(spent), company.currency)} hint={`of ${formatMoney(budget, company.currency)} cap`} />
        <Stat label="Waiting for you" value={approvals.length} hint="approvals" />
        <Stat label="Agent cost (recent)" value={`$${(runs.reduce((s, r) => s + r.costCents, 0) / 100).toFixed(2)}`} hint="last 8 runs" />
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-panel-2" aria-label="Budget used">
        <div className="h-full bg-gradient-to-r from-accent to-accent-2" style={{ width: `${Math.min(100, (Number(spent) / Math.max(1, budget)) * 100)}%` }} />
      </div>

      {!goal && company.status === 'active' && (
        <Card>
          <CardTitle>Set this month’s goals</CardTitle>
          <p className="mb-4 text-sm text-muted">Tell the agents what you want to achieve. They’ll research the market and draft the month’s plan.</p>
          <LinkButton href={`/companies/${company.slug}/plan`}>Set goals</LinkButton>
        </Card>
      )}

      {approvals.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Waiting for your approval</h2>
          <ApprovalList items={approvals} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle action={plan && goal && <Link href={`/companies/${company.slug}/plan/${goal.month}`} className="text-xs text-accent">Full calendar →</Link>}>Coming up</CardTitle>
          {upcoming.length ? (
            <ul className="divide-y divide-line text-sm">
              {upcoming.map(({ item, creative }) => (
                <li key={item.id} className="flex items-center gap-3 py-2">
                  <span className="w-24 shrink-0 text-xs text-muted">{item.scheduledFor.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                  <span className="min-w-0 flex-1 truncate">{item.brief}</span>
                  {item.isPaid && <Badge status="info">paid</Badge>}
                  {creative ? (
                    <Link href={`/companies/${company.slug}/creatives/${creative.id}`}>
                      <Badge status={creative.status} />
                    </Link>
                  ) : (
                    <Badge status="draft">not started</Badge>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="Nothing scheduled" />
          )}
        </Card>
        <Card>
          <CardTitle>Agent activity</CardTitle>
          {runs.length ? (
            <ul className="divide-y divide-line text-sm">
              {runs.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1 truncate">{r.workflow.replace(/-/g, ' ')}</span>
                  <span className="text-xs text-muted">{r.createdAt.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</span>
                  <Badge status={r.status} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No activity yet" />
          )}
        </Card>
      </div>
    </div>
  );
}
