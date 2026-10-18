import { desc, eq } from 'drizzle-orm';
import { schema } from '@/db';
import { currentBrand } from '@/lib/agents/context';
import { trainAction, updateBrandAction } from '@/app/actions';
import { ActionForm, SubmitButton } from '@/components/app/action-form';
import { ColorList } from '@/components/app/color-list';
import { Uploader } from '@/components/app/uploader';
import { PortfolioGrid } from '@/components/app/portfolio-grid';
import { Card, CardTitle, Empty, Swatch } from '@/components/ui/primitives';
import { getCompany } from '../data';

export const metadata = { title: 'Brand' };

export default async function Brand({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { company, db } = await getCompany(slug);
  const brand = await currentBrand(db, company.id);
  const versions = await db
    .select({ version: schema.brandProfiles.version, createdAt: schema.brandProfiles.createdAt })
    .from(schema.brandProfiles)
    .where(eq(schema.brandProfiles.companyId, company.id))
    .orderBy(desc(schema.brandProfiles.version));
  const heading = brand?.fonts.find((f) => f.role === 'heading')?.family;
  const body = brand?.fonts.find((f) => f.role === 'body')?.family;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <Card>
          <CardTitle
            action={
              <form action={trainAction.bind(null, company.id)}>
                <SubmitButton variant="ghost">Retrain</SubmitButton>
              </form>
            }
          >
            Brand bible {brand && <span className="ml-1 text-xs font-normal text-muted">v{brand.version}</span>}
          </CardTitle>
          {brand?.brandSummary ? (
            <div className="prose-sm whitespace-pre-wrap">{brand.brandSummary}</div>
          ) : (
            <Empty title="Not trained yet">Upload past work and press Retrain to have the agents write the brand bible.</Empty>
          )}
        </Card>
        <Card>
          <CardTitle>Edit brand</CardTitle>
          <ActionForm action={updateBrandAction.bind(null, company.id)} submit="Save new version">
            <div>
              <span className="label">Primary colours</span>
              <ColorList name="primaryColors" initial={brand?.primaryColors} />
            </div>
            <div>
              <span className="label">Secondary colours</span>
              <ColorList name="secondaryColors" initial={brand?.secondaryColors} />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <TextField name="headingFont" label="Heading font" value={heading} />
              <TextField name="bodyFont" label="Body font" value={body} />
              <TextField name="toneOfVoice" label="Tone of voice" value={brand?.toneOfVoice} wide />
              <TextField name="usp" label="What makes them different" value={brand?.usp} wide />
              <TextField name="targetAudience" label="Target audience" value={brand?.targetAudience} wide />
              <ListField name="brandValues" label="Values" value={brand?.brandValues} />
              <ListField name="competitors" label="Competitors" value={brand?.competitors} />
              <ListField name="dos" label="Always" value={brand?.dos} />
              <ListField name="donts" label="Never" value={brand?.donts} />
            </div>
            <label>
              <span className="label">Brand bible</span>
              <textarea name="brandSummary" defaultValue={brand?.brandSummary ?? ''} rows={10} className="field font-mono text-xs" />
            </label>
          </ActionForm>
        </Card>
      </div>
      <div className="space-y-6">
        <Card>
          <CardTitle>Identity</CardTitle>
          {brand?.logoAssetId ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/assets/${brand.logoAssetId}`} alt={`${company.name} logo`} className="mb-4 h-24 w-full rounded-lg border border-line bg-panel-2 object-contain p-3" />
          ) : (
            <p className="mb-4 text-sm text-muted">No logo yet.</p>
          )}
          <div className="flex flex-col gap-2">
            {[...(brand?.primaryColors ?? []), ...(brand?.secondaryColors ?? [])].map((c) => (
              <Swatch key={c} color={c} />
            ))}
          </div>
          {(heading || body) && (
            <p className="mt-3 text-sm text-muted">
              {heading} {body && `/ ${body}`}
            </p>
          )}
          <div className="mt-4">
            <Uploader companyId={company.id} purpose="logo" accept="image/png,image/svg+xml,image/webp" multiple={false} label="Replace logo" />
          </div>
        </Card>
        <Card>
          <CardTitle>Portfolio</CardTitle>
          <Uploader companyId={company.id} purpose="portfolio" accept="image/*,video/mp4,application/pdf,text/plain,text/markdown" label="Add past work" />
          <PortfolioGrid db={db} companyId={company.id} />
        </Card>
        <Card>
          <CardTitle>History</CardTitle>
          <ul className="space-y-1 text-sm text-muted">
            {versions.map((v) => (
              <li key={v.version}>
                v{v.version} · {v.createdAt.toLocaleDateString()}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function TextField({ name, label, value, wide }: { name: string; label: string; value?: string | null; wide?: boolean }) {
  return (
    <label className={wide ? 'md:col-span-2' : ''}>
      <span className="label">{label}</span>
      <input name={name} defaultValue={value ?? ''} className="field" />
    </label>
  );
}

function ListField({ name, label, value }: { name: string; label: string; value?: string[] }) {
  return (
    <label>
      <span className="label">{label} (one per line)</span>
      <textarea name={name} defaultValue={(value ?? []).join('\n')} rows={3} className="field" />
    </label>
  );
}
