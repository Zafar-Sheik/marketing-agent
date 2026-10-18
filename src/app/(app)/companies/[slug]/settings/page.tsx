import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import { disconnectTikTokAction, updateCompanyAction } from '@/app/actions';
import { ActionForm, SubmitButton } from '@/components/app/action-form';
import { TikTokConnect } from '@/components/app/tiktok-connect';
import { Card, CardTitle } from '@/components/ui/primitives';
import { getCompany } from '../data';

export const metadata = { title: 'Client settings' };

export default async function CompanySettings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { company, db } = await getCompany(slug);
  const [connection] = await db.select().from(schema.tiktokConnections).where(eq(schema.tiktokConnections.companyId, company.id));
  return (
    <div className="space-y-6">
      <Card>
        <CardTitle>TikTok</CardTitle>
        <TikTokConnect companyId={company.id} connection={connection} />
        {connection && (
          <form action={disconnectTikTokAction.bind(null, company.id)} className="mt-4">
            <SubmitButton variant="danger">Disconnect TikTok</SubmitButton>
          </form>
        )}
      </Card>
      <Card>
        <CardTitle>Details</CardTitle>
        <ActionForm action={updateCompanyAction.bind(null, company.id)} submit="Save" className="grid gap-4 md:grid-cols-2">
          <label>
            <span className="label">Name</span>
            <input name="name" defaultValue={company.name} className="field" />
          </label>
          <label>
            <span className="label">Industry</span>
            <input name="industry" defaultValue={company.industry ?? ''} className="field" />
          </label>
          <label>
            <span className="label">Website</span>
            <input name="websiteUrl" defaultValue={company.websiteUrl ?? ''} className="field" />
          </label>
          <label>
            <span className="label">Country</span>
            <input name="country" defaultValue={company.headquartersCountry ?? ''} maxLength={2} className="field uppercase" />
          </label>
          <label>
            <span className="label">Timezone</span>
            <input name="timezone" defaultValue={company.timezone} className="field" />
          </label>
          <label>
            <span className="label">Currency</span>
            <input name="currency" defaultValue={company.currency} maxLength={3} className="field uppercase" />
          </label>
          <label>
            <span className="label">Default monthly ad budget</span>
            <input name="budget" defaultValue={company.monthlyAdBudgetCents / 100} className="field" />
          </label>
          <label className="md:col-span-2">
            <span className="label">Description</span>
            <textarea name="description" defaultValue={company.description ?? ''} rows={4} className="field" />
          </label>
        </ActionForm>
      </Card>
    </div>
  );
}
