import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { schema } from '@/db';
import type { Providers } from '@/lib/providers';

export type BrandContext = {
  company: typeof schema.companies.$inferSelect;
  brand: typeof schema.brandProfiles.$inferSelect | undefined;
  memories: string[];
};

export async function currentBrand(d: Db, companyId: string) {
  const [brand] = await d
    .select()
    .from(schema.brandProfiles)
    .where(and(eq(schema.brandProfiles.companyId, companyId), eq(schema.brandProfiles.isCurrent, true)));
  return brand;
}

/** Company + current brand bible + the k most relevant memories for `query`. */
export async function brandContext(d: Db, p: Providers, companyId: string, query: string, k = 8): Promise<BrandContext> {
  const [company] = await d.select().from(schema.companies).where(eq(schema.companies.id, companyId));
  if (!company) throw new Error(`Company ${companyId} not found`);
  const brand = await currentBrand(d, companyId);
  const [vector] = await p.embeddings.embed([query]);
  const rows = await d
    .select({ content: schema.knowledgeChunks.content })
    .from(schema.knowledgeChunks)
    .where(eq(schema.knowledgeChunks.companyId, companyId))
    .orderBy(sql`${schema.knowledgeChunks.embedding} <=> ${JSON.stringify(vector)}::vector`)
    .limit(k);
  return { company, brand, memories: rows.map((r) => r.content) };
}

/** Renders brand context as a prompt section. */
export function brandBrief(ctx: BrandContext): string {
  const { company: c, brand: b } = ctx;
  const lines = [
    `<company>`,
    `Name: ${c.name}`,
    c.industry && `Industry: ${c.industry}`,
    c.websiteUrl && `Website: ${c.websiteUrl}`,
    c.headquartersCountry && `Country: ${c.headquartersCountry}`,
    `Currency: ${c.currency}`,
    c.description && `Description: ${c.description}`,
    `</company>`,
    b && `<brand version="${b.version}">`,
    b && `Primary colours: ${b.primaryColors.join(', ') || 'not set'}`,
    b?.secondaryColors.length && `Secondary colours: ${b.secondaryColors.join(', ')}`,
    b?.fonts.length && `Fonts: ${b.fonts.map((f) => `${f.family} (${f.role})`).join(', ')}`,
    b?.toneOfVoice && `Tone of voice: ${b.toneOfVoice}`,
    b?.brandValues.length && `Values: ${b.brandValues.join(', ')}`,
    b?.usp && `Unique selling point: ${b.usp}`,
    b?.targetAudience && `Target audience: ${b.targetAudience}`,
    b?.competitors.length && `Competitors: ${b.competitors.join(', ')}`,
    b?.dos.length && `Always: ${b.dos.join('; ')}`,
    b?.donts.length && `Never: ${b.donts.join('; ')}`,
    b?.brandSummary && `Brand bible:\n${b.brandSummary}`,
    b && `</brand>`,
    ctx.memories.length && `<brand_memory>\n${ctx.memories.map((m, i) => `[${i + 1}] ${m}`).join('\n\n')}\n</brand_memory>`,
  ];
  return lines.filter(Boolean).join('\n');
}

export async function latestPlanForGoal(d: Db, goalId: string) {
  const [plan] = await d
    .select()
    .from(schema.marketingPlans)
    .where(eq(schema.marketingPlans.monthlyGoalId, goalId))
    .orderBy(desc(schema.marketingPlans.version))
    .limit(1);
  return plan;
}
