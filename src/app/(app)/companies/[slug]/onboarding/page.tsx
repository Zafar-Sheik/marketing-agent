import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import { trainAction } from '@/app/actions';
import { Uploader } from '@/components/app/uploader';
import { PortfolioGrid } from '@/components/app/portfolio-grid';
import { TikTokConnect } from '@/components/app/tiktok-connect';
import { SubmitButton } from '@/components/app/action-form';
import { Card, CardTitle } from '@/components/ui/primitives';
import { getCompany } from '../data';

export const metadata = { title: 'Set up client' };

export default async function Onboarding({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { company, db } = await getCompany(slug);
  const [connection] = await db.select().from(schema.tiktokConnections).where(eq(schema.tiktokConnections.companyId, company.id));
  return (
    <div className="space-y-6">
      <Card>
        <CardTitle>1 · Past work</CardTitle>
        <p className="mb-4 text-sm text-muted">Photos, past ads, menus, brand guidelines (PDF or text). The more, the better the agents understand the brand.</p>
        <Uploader companyId={company.id} purpose="portfolio" accept="image/*,video/mp4,application/pdf,text/plain,text/markdown" label="Upload portfolio" />
        <PortfolioGrid db={db} companyId={company.id} />
      </Card>
      <Card>
        <CardTitle>2 · Logo</CardTitle>
        <p className="mb-4 text-sm text-muted">PNG or SVG with a transparent background works best. No logo? Ask the agents to design one in the Logos tab later.</p>
        <Uploader companyId={company.id} purpose="logo" accept="image/png,image/svg+xml,image/webp" multiple={false} label="Upload logo" />
      </Card>
      <Card>
        <CardTitle>3 · Connect TikTok</CardTitle>
        <TikTokConnect companyId={company.id} connection={connection} />
        <p className="mt-3 text-xs text-muted">You can skip this and connect later; planning and content work without it.</p>
      </Card>
      <Card className="border-accent/40">
        <CardTitle>4 · Train the agents</CardTitle>
        <p className="mb-4 text-sm text-muted">The agents caption your work, read the website and write a brand bible. Takes a minute or two.</p>
        <form action={trainAction.bind(null, company.id)}>
          <SubmitButton>Start training</SubmitButton>
        </form>
      </Card>
    </div>
  );
}
