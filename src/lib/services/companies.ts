import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Db } from '@/db';
import { currentBrand } from '@/lib/agents/context';
import { normalizeHex, slugify } from '@/lib/domain/text';
import { startWorkflow } from '@/lib/engine/runs';

const hexList = z
  .array(z.string())
  .default([])
  .transform((l) => l.filter(Boolean).map(normalizeHex));
const list = z
  .array(z.string())
  .default([])
  .transform((l) => l.map((s) => s.trim()).filter(Boolean));

export const companyInput = z.object({
  name: z.string().trim().min(1).max(120),
  industry: z.string().trim().max(120).optional(),
  websiteUrl: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? (/^https?:\/\//.test(v) ? v : `https://${v}`) : undefined))
    .pipe(z.string().url().optional()),
  description: z.string().trim().max(4000).optional(),
  headquartersCountry: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  timezone: z.string().default('UTC'),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .default('USD'),
  monthlyAdBudgetCents: z.number().int().min(0).default(0),
});

export const brandInput = z.object({
  primaryColors: hexList,
  secondaryColors: hexList,
  headingFont: z.string().trim().optional(),
  bodyFont: z.string().trim().optional(),
  toneOfVoice: z.string().trim().max(2000).optional(),
  brandValues: list,
  usp: z.string().trim().max(2000).optional(),
  targetAudience: z.string().trim().max(2000).optional(),
  competitors: list,
  dos: list,
  donts: list,
});

export async function createCompany(db: Db, workspaceId: string, userId: string, company: z.input<typeof companyInput>, brand: z.input<typeof brandInput>) {
  const c = companyInput.parse(company);
  const b = brandInput.parse(brand);
  const base = slugify(c.name);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.companies)
    .where(and(eq(schema.companies.workspaceId, workspaceId), sql`${schema.companies.slug} ~ ${`^${base}(-[0-9]+)?$`}`));
  const [created] = await db
    .insert(schema.companies)
    .values({ ...c, workspaceId, slug: n ? `${base}-${n + 1}` : base, createdBy: userId })
    .returning();
  await db.insert(schema.brandProfiles).values({
    companyId: created.id,
    version: 1,
    isCurrent: true,
    primaryColors: b.primaryColors,
    secondaryColors: b.secondaryColors,
    fonts: [
      ...(b.headingFont ? [{ family: b.headingFont, role: 'heading' as const }] : []),
      ...(b.bodyFont ? [{ family: b.bodyFont, role: 'body' as const }] : []),
    ],
    toneOfVoice: b.toneOfVoice,
    brandValues: b.brandValues,
    usp: b.usp,
    targetAudience: b.targetAudience,
    competitors: b.competitors,
    dos: b.dos,
    donts: b.donts,
  });
  return created;
}

/** Copy the current brand profile into a new version with `patch` applied. */
export async function createNewBrandVersion(db: Db, companyId: string, patch: Partial<typeof schema.brandProfiles.$inferInsert>) {
  const brand = await currentBrand(db, companyId);
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${schema.brandProfiles.version}), 0)` })
    .from(schema.brandProfiles)
    .where(eq(schema.brandProfiles.companyId, companyId));
  if (brand) await db.update(schema.brandProfiles).set({ isCurrent: false }).where(eq(schema.brandProfiles.id, brand.id));
  const { id: _id, createdAt: _createdAt, version: _version, isCurrent: _isCurrent, ...rest } = brand ?? ({} as NonNullable<typeof brand>);
  const [profile] = await db
    .insert(schema.brandProfiles)
    .values({ ...rest, ...patch, companyId, version: Number(max) + 1, isCurrent: true })
    .returning();
  return profile;
}

export async function startTraining(db: Db, companyId: string) {
  await db.update(schema.companies).set({ status: 'training' }).where(eq(schema.companies.id, companyId));
  return startWorkflow('brand-training', { companyId, subjectType: 'company', subjectId: companyId });
}
