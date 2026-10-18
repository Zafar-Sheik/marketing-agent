import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { schema } from '@/db';
import { env } from '@/env';
import { daysInMonth, formatMonth, monthStart, parseIsoDate } from '@/lib/domain/dates';
import { formatMoney } from '@/lib/domain/money';
import { RUN_STEPS } from '@/lib/run-labels';
import { ApprovalButtons } from '@/components/app/approval-buttons';
import { AutoRefresh, RunProgress } from '@/components/app/live';
import { Badge, Card, CardTitle, Empty } from '@/components/ui/primitives';
import { getCompany } from '../../data';

export const metadata = { title: 'Monthly plan' };

type Trend = { name: string; format: string; whyItWorks: string; howToUse: string; sourceUrl: string };
type Competitor = { name: string; whatTheyDo: string; opportunity: string; sourceUrl: string };
type Audience = { summary?: string; peakPostingTimes?: string[]; motivations?: string[]; objections?: string[] };

export default async function PlanMonth({ params, searchParams }: { params: Promise<{ slug: string; month: string }>; searchParams: Promise<{ v?: string }> }) {
  const { slug, month: raw } = await params;
  const { v } = await searchParams;
  if (!/^\d{4}-\d{2}-01$/.test(raw)) notFound();
  const month = monthStart(raw);
  const { company, db } = await getCompany(slug);
  const [goal] = await db.select().from(schema.monthlyGoals).where(and(eq(schema.monthlyGoals.companyId, company.id), eq(schema.monthlyGoals.month, month)));
  if (!goal) notFound();
  const plans = await db.select().from(schema.marketingPlans).where(eq(schema.marketingPlans.monthlyGoalId, goal.id)).orderBy(desc(schema.marketingPlans.version));
  const plan = plans.find((p) => String(p.version) === v) ?? plans[0];
  const [research] = await db.select().from(schema.researchReports).where(eq(schema.researchReports.monthlyGoalId, goal.id)).orderBy(desc(schema.researchReports.createdAt)).limit(1);
  const [run] = await db.select().from(schema.agentRuns).where(and(eq(schema.agentRuns.subjectId, goal.id), eq(schema.agentRuns.workflow, 'monthly-plan'))).orderBy(desc(schema.agentRuns.createdAt)).limit(1);
  const items = plan
    ? await db
        .select({ item: schema.planItems, creative: schema.creatives })
        .from(schema.planItems)
        .leftJoin(schema.creatives, eq(schema.creatives.planItemId, schema.planItems.id))
        .where(eq(schema.planItems.marketingPlanId, plan.id))
        .orderBy(schema.planItems.scheduledFor)
    : [];
  const [approval] = plan
    ? await db.select().from(schema.approvals).where(and(eq(schema.approvals.subjectId, plan.id), inArray(schema.approvals.decision, ['pending'])))
    : [];
  const segments = research ? await db.select().from(schema.audienceSegments).where(eq(schema.audienceSegments.researchReportId, research.id)) : [];
  const working = run && (run.status === 'queued' || run.status === 'running');
  const paid = items.filter((i) => i.item.isPaid).reduce((s, i) => s + i.item.plannedSpendCents, 0);

  return (
    <div className="space-y-6">
      <AutoRefresh active={Boolean(working)} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{formatMonth(month)}</h2>
          <p className="max-w-3xl text-sm text-muted">{goal.prompt}</p>
        </div>
        {plan && <Badge status={plan.status} />}
      </div>

      {working && (
        <Card>
          <CardTitle>Agents at work</CardTitle>
          <RunProgress runId={run.id} steps={[...RUN_STEPS['monthly-plan']]} />
        </Card>
      )}
      {run?.status === 'failed' && <p className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">Planning failed: {run.error}</p>}

      {plan && approval && (
        <Card className="border-warn/40">
          <CardTitle>Approve this plan?</CardTitle>
          <p className="mb-4 text-sm text-muted">
            Approving starts production of the next {env().PRODUCTION_LEAD_DAYS} days of content. Paid placements total {formatMoney(paid, company.currency)} of your {formatMoney(goal.adBudgetCents, company.currency)} budget, and each still needs your approval before spend.
          </p>
          <ApprovalButtons approvalId={approval.id} />
        </Card>
      )}

      {plan && (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardTitle action={plans.length > 1 && <VersionPicker plans={plans} current={plan.version} base={`/companies/${company.slug}/plan/${month}`} />}>Strategy</CardTitle>
            {plan.feedback && <p className="mb-3 rounded-lg bg-panel-2 px-3 py-2 text-xs text-muted">Revised for: “{plan.feedback}”</p>}
            <div className="prose-sm whitespace-pre-wrap">{plan.strategy}</div>
          </Card>
          <div className="space-y-6">
            <Card>
              <CardTitle>Content pillars</CardTitle>
              <ul className="space-y-2 text-sm">
                {plan.contentPillars.map((p) => (
                  <li key={p.name}>
                    <div className="flex justify-between font-medium">
                      {p.name} <span className="text-muted">{Math.round(p.share * 100)}%</span>
                    </div>
                    <div className="text-xs text-muted">{p.description}</div>
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <CardTitle>Paid budget split</CardTitle>
              <ul className="space-y-1 text-sm">
                {Object.entries(plan.budgetAllocation).map(([k, share]) => (
                  <li key={k} className="flex justify-between">
                    <span className="capitalize">{k.replace(/_/g, ' ')}</span>
                    <span className="text-muted">{formatMoney(Math.round(goal.adBudgetCents * share), company.currency)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}

      {plan && (
        <Card>
          <CardTitle>Calendar</CardTitle>
          <Calendar month={month} items={items} slug={company.slug} timeZone={company.timezone} />
        </Card>
      )}

      {research && research.status === 'succeeded' && (
        <Card>
          <CardTitle>Market research</CardTitle>
          <p className="mb-4 text-sm">{research.executiveSummary}</p>
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="label">Trends</h3>
              <ul className="space-y-3 text-sm">
                {(research.trends as Trend[]).map((t) => (
                  <li key={t.name}>
                    <div className="font-medium">
                      {t.name} <span className="text-xs text-muted">· {t.format}</span>
                    </div>
                    <div className="text-muted">{t.whyItWorks}</div>
                    <div>{t.howToUse}</div>
                    <SourceLink url={t.sourceUrl} />
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-6">
              <div>
                <h3 className="label">Competitors</h3>
                <ul className="space-y-3 text-sm">
                  {(research.competitors as Competitor[]).map((c) => (
                    <li key={c.name}>
                      <div className="font-medium">{c.name}</div>
                      <div className="text-muted">{c.whatTheyDo}</div>
                      <div>Opportunity: {c.opportunity}</div>
                      <SourceLink url={c.sourceUrl} />
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="label">Audience</h3>
                <p className="text-sm">{(research.audienceInsights as Audience).summary}</p>
                <p className="mt-1 text-xs text-muted">Best times: {(research.audienceInsights as Audience).peakPostingTimes?.join(', ')}</p>
              </div>
              <div>
                <h3 className="label">Ad audiences</h3>
                <ul className="space-y-2 text-sm">
                  {segments.map((s) => (
                    <li key={s.id}>
                      <span className="font-medium">{s.name}</span>{' '}
                      <span className="text-muted">
                        {s.ageGroups.map((a) => a.replace('AGE_', '').replace('_', '–')).join(', ')} · {s.interestLabels.join(', ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
          <details className="mt-4 text-xs text-muted">
            <summary className="cursor-pointer">{research.sources.length} sources</summary>
            <ul className="mt-2 space-y-1">
              {research.sources.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noreferrer" className="hover:underline">
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        </Card>
      )}
      {!plan && !working && run?.status !== 'failed' && <Empty title="No plan yet" />}
    </div>
  );
}

function SourceLink({ url }: { url: string }) {
  if (!/^https?:\/\//.test(url)) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
      source
    </a>
  );
}

function VersionPicker({ plans, current, base }: { plans: { version: number; status: string }[]; current: number; base: string }) {
  return (
    <div className="flex gap-1 text-xs">
      {plans.map((p) => (
        <Link key={p.version} href={`${base}?v=${p.version}`} className={`rounded px-2 py-0.5 ${p.version === current ? 'bg-accent/20 text-fg' : 'text-muted hover:text-fg'}`}>
          v{p.version}
        </Link>
      ))}
    </div>
  );
}

type Row = { item: typeof schema.planItems.$inferSelect; creative: typeof schema.creatives.$inferSelect | null };

function Calendar({ month, items, slug, timeZone }: { month: string; items: Row[]; slug: string; timeZone: string }) {
  const first = parseIsoDate(month);
  const offset = (first.getUTCDay() + 6) % 7;
  const days = daysInMonth(month);
  const dayOf = (d: Date) => Number(new Intl.DateTimeFormat('en-CA', { timeZone, day: 'numeric' }).format(d));
  const cells = Array.from({ length: offset + days }, (_, i) => (i < offset ? null : i - offset + 1));
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[720px] grid-cols-7 gap-px overflow-hidden rounded-lg border border-line bg-line text-xs">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="bg-panel-2 px-2 py-1 font-medium text-muted">
            {d}
          </div>
        ))}
        {cells.map((day, i) => (
          <div key={i} className="min-h-24 bg-panel p-1.5">
            {day && <div className="mb-1 text-muted">{day}</div>}
            {day &&
              items
                .filter((r) => dayOf(r.item.scheduledFor) === day)
                .map(({ item, creative }) => (
                  <Link
                    key={item.id}
                    href={creative ? `/companies/${slug}/creatives/${creative.id}` : '#'}
                    title={item.brief}
                    className={`mb-1 block rounded border px-1.5 py-1 leading-tight ${item.isPaid ? 'border-accent-2/40 bg-accent-2/10' : 'border-accent/30 bg-accent/10'}`}
                  >
                    <span className="line-clamp-2">{item.brief}</span>
                    <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted">
                      {item.format.replace('_', ' ')}
                      {creative && <Badge status={creative.status} />}
                    </span>
                  </Link>
                ))}
          </div>
        ))}
      </div>
    </div>
  );
}
