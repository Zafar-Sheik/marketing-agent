import Link from 'next/link';
import type { pendingApprovals } from '@/lib/queries';
import { formatMoney } from '@/lib/domain/money';
import { formatMonth } from '@/lib/domain/dates';
import { Badge, Card } from '@/components/ui/primitives';
import { ApprovalButtons } from './approval-buttons';

type Item = Awaited<ReturnType<typeof pendingApprovals>>[number];

export function ApprovalList({ items, showCompany }: { items: Item[]; showCompany?: boolean }) {
  return (
    <div className="grid gap-4">
      {items.map((i) => (
        <Card key={i.approval.id} className="flex flex-col gap-4 md:flex-row">
          {i.thumb && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/assets/${i.thumb}`} alt="" className="h-48 w-28 shrink-0 rounded-lg border border-line object-cover" />
          )}
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              {showCompany && (
                <Link href={`/companies/${i.company.slug}`} className="font-medium text-fg hover:underline">
                  {i.company.name}
                </Link>
              )}
              <Badge status="pending">{label(i)}</Badge>
              <span>{i.approval.requestedAt.toLocaleString()}</span>
            </div>
            <Summary i={i} />
          </div>
          <div className="md:w-80">
            <ApprovalButtons
              approvalId={i.approval.id}
              allowChanges={i.approval.subjectType !== 'ad_campaign'}
              approveLabel={i.approval.subjectType === 'ad_campaign' ? 'Approve spend' : 'Approve'}
            />
          </div>
        </Card>
      ))}
    </div>
  );
}

function label(i: Item) {
  if (i.approval.comment?.startsWith('OPTIMISE:')) return 'budget change';
  return { marketing_plan: 'monthly plan', creative: 'content', ad_campaign: 'ad spend', logo_request: 'logo' }[i.approval.subjectType];
}

function Summary({ i }: { i: Item }) {
  const base = `/companies/${i.company.slug}`;
  if (i.plan && i.goal) {
    return (
      <>
        <Link href={`${base}/plan/${i.goal.month}`} className="font-semibold hover:underline">
          {formatMonth(i.goal.month)} plan · version {i.plan.version}
        </Link>
        <p className="line-clamp-3 text-sm text-muted">{i.plan.strategy}</p>
      </>
    );
  }
  if (i.creative) {
    return (
      <>
        <Link href={`${base}/creatives/${i.creative.id}`} className="font-semibold hover:underline">
          {i.creative.hook ?? i.creative.concept}
        </Link>
        <p className="text-sm text-muted">{i.creative.caption}</p>
        <p className="text-xs text-muted">
          {i.creative.format.replace('_', ' ')} · brand score {i.creative.brandScore != null ? Math.round(i.creative.brandScore * 100) : '–'}%
        </p>
      </>
    );
  }
  if (i.approval.comment?.startsWith('OPTIMISE:')) {
    const proposals = JSON.parse(i.approval.comment.slice(9)) as { action: { type: string; reason: string; dailyBudgetCents?: number }; why: string }[];
    return (
      <ul className="space-y-1 text-sm">
        {proposals.map((p, n) => (
          <li key={n}>
            <span className="font-medium">{p.action.type.replace(/_/g, ' ')}</span>
            {p.action.dailyBudgetCents != null && ` → ${formatMoney(p.action.dailyBudgetCents, i.company.currency)}/day`}: {p.action.reason} <span className="text-muted">({p.why})</span>
          </li>
        ))}
      </ul>
    );
  }
  if (i.campaign) {
    return (
      <>
        <Link href={`${base}/ads`} className="font-semibold hover:underline">
          {i.campaign.name}
        </Link>
        <p className="text-sm">
          {formatMoney(i.campaign.budgetCents, i.company.currency)} total · {i.group && formatMoney(i.group.dailyBudgetCents, i.company.currency)}/day · {i.campaign.objective}
        </p>
        {i.segment && (
          <p className="text-sm text-muted">
            Audience: {i.segment.name} · {i.segment.ageGroups.map((a) => a.replace('AGE_', '').replace('_', '–')).join(', ')} ·{' '}
            {i.segment.genders.map((g) => g.replace('GENDER_', '').toLowerCase()).join(', ')} · {i.segment.interestLabels.join(', ')}
          </p>
        )}
        {i.ad && <p className="text-sm">“{i.ad.adText}” · {i.ad.callToAction?.replace(/_/g, ' ').toLowerCase()}</p>}
        {i.segment?.rationale && <p className="text-xs text-muted">{i.segment.rationale}</p>}
      </>
    );
  }
  return <p className="text-sm text-muted">Unknown item</p>;
}
