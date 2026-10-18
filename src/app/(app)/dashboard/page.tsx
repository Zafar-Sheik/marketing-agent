import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { Plus } from 'lucide-react';
import { schema } from '@/db';
import { requireUser } from '@/lib/session';
import { monthStart } from '@/lib/domain/dates';
import { formatMoney } from '@/lib/domain/money';
import { HoverCardGrid } from '@/components/ui/hover-card-grid';
import { Badge, Empty, LinkButton, Stat } from '@/components/ui/primitives';

export const metadata = { title: 'Dashboard' };

export default async function Dashboard() {
  const { db, workspace } = await requireUser();
  const month = monthStart(new Date());
  const companies = await db.select().from(schema.companies).where(eq(schema.companies.workspaceId, workspace.id)).orderBy(schema.companies.name);
  const ids = companies.map((c) => c.id);
  const none = ['00000000-0000-0000-0000-000000000000'];

  const spend = await db
    .select({ companyId: schema.adCampaigns.companyId, cents: sql<number>`coalesce(sum(${schema.adMetricsDaily.spendCents}), 0)::bigint` })
    .from(schema.adMetricsDaily)
    .innerJoin(schema.ads, eq(schema.ads.id, schema.adMetricsDaily.adId))
    .innerJoin(schema.adGroups, eq(schema.adGroups.id, schema.ads.adGroupId))
    .innerJoin(schema.adCampaigns, eq(schema.adCampaigns.id, schema.adGroups.adCampaignId))
    .where(and(inArray(schema.adCampaigns.companyId, ids.length ? ids : none), gte(schema.adMetricsDaily.date, month)))
    .groupBy(schema.adCampaigns.companyId);
  const published = await db
    .select({ companyId: schema.creatives.companyId, n: sql<number>`count(*)::int` })
    .from(schema.creatives)
    .where(and(inArray(schema.creatives.companyId, ids.length ? ids : none), eq(schema.creatives.status, 'published'), gte(schema.creatives.updatedAt, new Date(`${month}T00:00:00Z`))))
    .groupBy(schema.creatives.companyId);
  const [{ pending }] = await db
    .select({ pending: sql<number>`count(*)::int` })
    .from(schema.approvals)
    .where(and(inArray(schema.approvals.companyId, ids.length ? ids : none), eq(schema.approvals.decision, 'pending')));
  const [{ working }] = await db
    .select({ working: sql<number>`count(*)::int` })
    .from(schema.agentRuns)
    .where(and(inArray(schema.agentRuns.companyId, ids.length ? ids : none), inArray(schema.agentRuns.status, ['queued', 'running'])));

  const spendOf = (id: string) => Number(spend.find((s) => s.companyId === id)?.cents ?? 0);
  const publishedOf = (id: string) => published.find((p) => p.companyId === id)?.n ?? 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted">{workspace.autopilot ? 'Autopilot is on: agents approve their own work within guardrails.' : 'Agents ask before anything spends money or goes public.'}</p>
        </div>
        <LinkButton href="/companies/new">
          <Plus className="size-4" /> New client
        </LinkButton>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Clients" value={companies.length} hint={`${companies.filter((c) => c.status === 'active').length} active`} />
        <Stat label="Waiting for you" value={pending} hint="approvals" />
        <Stat label="Agents working" value={working} hint="runs in progress" />
        <Stat label="Published this month" value={published.reduce((s, p) => s + p.n, 0)} hint="posts and ads" />
      </div>
      {companies.length ? (
        <HoverCardGrid
          className="-mx-2"
          items={companies.map((c) => ({
            key: c.id,
            href: `/companies/${c.slug}`,
            title: (
              <span className="flex items-center justify-between gap-2">
                {c.name} <Badge status={c.status} />
              </span>
            ),
            description: c.industry ?? c.description ?? 'No description',
            footer: (
              <div className="flex justify-between text-xs text-muted">
                <span>
                  Spend {formatMoney(spendOf(c.id), c.currency)} / {formatMoney(c.monthlyAdBudgetCents, c.currency)}
                </span>
                <span>{publishedOf(c.id)} published</span>
              </div>
            ),
          }))}
        />
      ) : (
        <Empty title="Add your first client">Give it a name, brand colours and some past work. The agents take it from there.</Empty>
      )}
    </div>
  );
}
