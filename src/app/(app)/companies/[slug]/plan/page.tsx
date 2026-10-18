import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { schema } from '@/db';
import { createGoalAction } from '@/app/actions';
import { formatMonth, monthStart, nextMonth } from '@/lib/domain/dates';
import { formatMoney } from '@/lib/domain/money';
import { ActionForm } from '@/components/app/action-form';
import { Card, CardTitle } from '@/components/ui/primitives';
import { getCompany } from '../data';

export const metadata = { title: 'Plan' };

export default async function Plans({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { company, db } = await getCompany(slug);
  const goals = await db.select().from(schema.monthlyGoals).where(eq(schema.monthlyGoals.companyId, company.id)).orderBy(desc(schema.monthlyGoals.month));
  const thisMonth = monthStart(new Date());
  const suggested = goals.some((g) => g.month === thisMonth) ? nextMonth(thisMonth) : thisMonth;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <Card>
        <CardTitle>Set monthly goals</CardTitle>
        <ActionForm action={createGoalAction.bind(null, company.id)} submit="Research & plan">
          <div className="grid gap-4 md:grid-cols-2">
            <label>
              <span className="label">Month</span>
              <input type="month" name="month" defaultValue={suggested.slice(0, 7)} required className="field" />
            </label>
            <label>
              <span className="label">Ad budget ({company.currency})</span>
              <input name="budget" inputMode="decimal" defaultValue={company.monthlyAdBudgetCents / 100} className="field" />
            </label>
          </div>
          <label>
            <span className="label">What do you want to achieve?</span>
            <textarea
              name="prompt"
              required
              rows={5}
              className="field"
              placeholder="Launch the summer menu, grow followers by 20%, drive bookings for the new Sea Point branch. Push the 2-for-1 smoothie deal on Fridays."
            />
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label>
              <span className="label">KPIs (metric: target, one per line)</span>
              <textarea name="kpis" rows={3} className="field" placeholder={'followers: 20%\nwebsite clicks: 3000'} />
            </label>
            <label>
              <span className="label">Target countries (ISO codes)</span>
              <input name="locations" className="field" defaultValue={company.headquartersCountry ?? ''} placeholder="ZA, NA" />
            </label>
          </div>
        </ActionForm>
      </Card>
      <Card>
        <CardTitle>Months</CardTitle>
        {goals.length ? (
          <ul className="space-y-2">
            {goals.map((g) => (
              <li key={g.id}>
                <Link href={`/companies/${company.slug}/plan/${g.month}`} className="block rounded-lg border border-line p-3 hover:border-accent/50">
                  <div className="font-medium">{formatMonth(g.month)}</div>
                  <div className="line-clamp-2 text-xs text-muted">{g.prompt}</div>
                  <div className="mt-1 text-xs text-muted">Budget {formatMoney(g.adBudgetCents, company.currency)}</div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No months planned yet.</p>
        )}
      </Card>
    </div>
  );
}
