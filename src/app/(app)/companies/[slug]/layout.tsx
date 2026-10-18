import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import { Badge } from '@/components/ui/primitives';
import { getCompany } from './data';
import { CompanyTabs } from './tabs';

export default async function CompanyLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { company, db } = await getCompany(slug);
  const [connection] = await db.select().from(schema.tiktokConnections).where(eq(schema.tiktokConnections.companyId, company.id));
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{company.name}</h1>
          <Badge status={company.status} />
          {company.industry && <span className="text-sm text-muted">{company.industry}</span>}
        </div>
        {connection && connection.status !== 'connected' && (
          <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">
            TikTok connection {connection.status}. Jobs that need TikTok will fail until you{' '}
            <Link href={`/companies/${company.slug}/settings`} className="underline">
              reconnect
            </Link>
            .
          </div>
        )}
        <CompanyTabs slug={company.slug} />
      </div>
      {children}
    </div>
  );
}
