import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { schema } from '@/db';
import { createRequestAction } from '@/app/actions';
import { weekStart } from '@/lib/domain/dates';
import { ActionForm } from '@/components/app/action-form';
import { Badge, Card, CardTitle, Empty } from '@/components/ui/primitives';
import { getCompany } from '../data';

export const metadata = { title: 'Requests' };

export default async function Requests({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { company, db } = await getCompany(slug);
  const requests = await db
    .select({ request: schema.contentRequests, creative: schema.creatives })
    .from(schema.contentRequests)
    .leftJoin(schema.creatives, eq(schema.creatives.contentRequestId, schema.contentRequests.id))
    .where(eq(schema.contentRequests.companyId, company.id))
    .orderBy(desc(schema.contentRequests.createdAt))
    .limit(50);
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <Card>
        <CardTitle>Ask for something specific</CardTitle>
        <ActionForm action={createRequestAction.bind(null, company.id)} submit="Request">
          <label>
            <span className="label">What should we make?</span>
            <textarea name="prompt" required rows={4} className="field" placeholder="A 15-second video for Friday’s 2-for-1 smoothie deal, filmed-in-store feel, end on ‘Fridays only’." />
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label>
              <span className="label">Format</span>
              <select name="format" className="field">
                <option value="short_video">Short video</option>
                <option value="image_post">Image post</option>
                <option value="carousel">Carousel</option>
              </select>
            </label>
            <label>
              <span className="label">Week of</span>
              <input type="date" name="week" defaultValue={weekStart(new Date())} className="field" />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isPaid" className="size-4 accent-[#7c5cff]" /> Run as a paid ad (budget comes from this month’s cap)
          </label>
        </ActionForm>
      </Card>
      <Card>
        <CardTitle>Requests</CardTitle>
        {requests.length ? (
          <ul className="divide-y divide-line text-sm">
            {requests.map(({ request, creative }) => (
              <li key={request.id} className="flex items-start gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2">{request.prompt}</div>
                  <div className="text-xs text-muted">
                    Week of {request.weekStart} · {request.format.replace('_', ' ')}
                    {request.isPaid && ' · paid'}
                  </div>
                </div>
                {creative ? (
                  <Link href={`/companies/${company.slug}/creatives/${creative.id}`}>
                    <Badge status={creative.status} />
                  </Link>
                ) : (
                  <Badge status={request.status} />
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="No requests yet">Anything you ask for here is fitted into the month’s plan and made on brand.</Empty>
        )}
      </Card>
    </div>
  );
}
