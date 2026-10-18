import { and, desc, eq, inArray } from 'drizzle-orm';
import { schema } from '@/db';
import { generateReportAction } from '@/app/actions';
import { formatMonth, monthStart } from '@/lib/domain/dates';
import { formatMoney } from '@/lib/domain/money';
import { SubmitButton } from '@/components/app/action-form';
import { AutoRefresh } from '@/components/app/live';
import { Badge, Card, CardTitle, Empty, LinkButton } from '@/components/ui/primitives';
import { getCompany } from '../data';

export const metadata = { title: 'Reports' };

type Breakdown = { title: string; format: string; hook: string; audience: string; spendCents: number; impressions: number; clicks: number; views: number; results: string; learnings: string }[];

export default async function Reports({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { company, db } = await getCompany(slug);
  const reports = await db.select().from(schema.monthlyReports).where(eq(schema.monthlyReports.companyId, company.id)).orderBy(desc(schema.monthlyReports.month));
  const [running] = await db
    .select()
    .from(schema.agentRuns)
    .where(and(eq(schema.agentRuns.companyId, company.id), eq(schema.agentRuns.workflow, 'monthly-report'), inArray(schema.agentRuns.status, ['queued', 'running'])));
  return (
    <div className="space-y-6">
      <AutoRefresh active={Boolean(running)} />
      <Card>
        <CardTitle>Monthly documentation</CardTitle>
        <p className="mb-4 text-sm text-muted">Generated automatically on the 1st for the month before. Generate one now for any month:</p>
        <form action={generateReportAction.bind(null, company.id)} className="flex gap-2">
          <input type="month" name="month" defaultValue={monthStart(new Date()).slice(0, 7)} className="field max-w-48" />
          <SubmitButton variant="ghost">{running ? 'Working…' : 'Generate report'}</SubmitButton>
        </form>
      </Card>
      {reports.length ? (
        reports.map((r) => (
          <Card key={r.id}>
            <CardTitle
              action={
                <div className="flex items-center gap-2">
                  <Badge status={r.status} />
                  {r.pdfAssetId && (
                    <LinkButton href={`/api/assets/${r.pdfAssetId}`} variant="ghost">
                      Download PDF
                    </LinkButton>
                  )}
                </div>
              }
            >
              {formatMonth(r.month)}
            </CardTitle>
            <p className="text-sm">{r.summary}</p>
            {r.kpiResults.length > 0 && (
              <ul className="mt-4 grid gap-2 md:grid-cols-3">
                {r.kpiResults.map((k) => (
                  <li key={k.metric} className="rounded-lg border border-line p-3 text-sm">
                    <div className="text-xs uppercase text-muted">{k.metric}</div>
                    <div className="text-lg font-semibold">
                      {k.actual} <span className="text-xs font-normal text-muted">/ {k.target}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-accent">Per-advert documentation ({(r.creativeBreakdown as Breakdown).length})</summary>
              <ul className="mt-3 space-y-3 text-sm">
                {(r.creativeBreakdown as Breakdown).map((b, i) => (
                  <li key={i} className="rounded-lg border border-line p-3">
                    <div className="font-medium">
                      {b.title} <span className="text-xs text-muted">({b.format})</span>
                    </div>
                    <div className="text-muted">Hook: {b.hook} · Audience: {b.audience}</div>
                    <div>
                      {formatMoney(b.spendCents, company.currency)} · {b.impressions.toLocaleString()} impressions · {b.clicks.toLocaleString()} clicks · {b.views.toLocaleString()} organic views
                    </div>
                    <div className="text-muted">{b.learnings}</div>
                  </li>
                ))}
              </ul>
            </details>
            {r.recommendations && (
              <div className="mt-4">
                <h3 className="label">Next month</h3>
                <p className="whitespace-pre-wrap text-sm">{r.recommendations}</p>
              </div>
            )}
          </Card>
        ))
      ) : (
        <Empty title="No reports yet" />
      )}
    </div>
  );
}
