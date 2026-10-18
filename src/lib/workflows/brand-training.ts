import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@/db';
import { chunkText } from '@/lib/domain/text';
import { BRAND_STRATEGIST, VISUAL_ANALYST } from '@/lib/agents/prompts';
import { brandBrief, currentBrand } from '@/lib/agents/context';
import type { WorkflowDef } from '@/lib/engine/types';

const captionSchema = z.object({
  description: z.string().describe('Factual description of the visual and what it says about the brand'),
  palette: z.array(z.string()).describe('Dominant colours as #RRGGBB'),
});

const bibleSchema = z.object({
  brandSummary: z.string().describe('The brand bible, 300-600 words, in markdown'),
  toneOfVoice: z.string(),
  brandValues: z.array(z.string()),
  usp: z.string(),
  targetAudience: z.string(),
  dos: z.array(z.string()),
  donts: z.array(z.string()),
  suggestedPrimaryColors: z.array(z.string()).describe('#RRGGBB, only if none were provided'),
});

/** Portfolio + website + questionnaire -> embeddings (brand memory) + brand bible. */
export const brandTraining: WorkflowDef = {
  first: 'ingest',
  steps: {
    async ingest({ db, providers: p, run, state, addCost, log }) {
      const companyId = run.companyId!;
      const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId));
      const [training] = await db
        .insert(schema.trainingRuns)
        .values({ companyId, status: 'running', startedAt: new Date() })
        .returning();
      state.trainingRunId = training.id;

      const docs: { content: string; sourceType: string; assetId?: string }[] = [];

      // 1. Caption every portfolio image with a vision model.
      const items = await db
        .select({ item: schema.portfolioItems, asset: schema.assets })
        .from(schema.portfolioItems)
        .innerJoin(schema.assets, eq(schema.assets.id, schema.portfolioItems.assetId))
        .where(eq(schema.portfolioItems.companyId, companyId));
      for (const { item, asset } of items) {
        if (asset.mimeType.startsWith('image/') && !item.aiDescription) {
          const url = await p.storage.presignGet(asset.s3Key, 3600);
          const res = await p.llm.structured({
            system: VISUAL_ANALYST,
            prompt: `Describe this piece from ${company.name}'s portfolio.${item.notes ? ` Notes from the client: ${item.notes}` : ''}`,
            schema: captionSchema,
            images: [{ url }],
            tier: 'fast',
            mock: () => ({ description: `${item.title ?? 'Portfolio image'}: clean product shot, bright and friendly.`, palette: ['#0F766E'] }),
          });
          addCost(res.costCents);
          item.aiDescription = `${res.data.description} Palette: ${res.data.palette.join(', ')}`;
          await db.update(schema.portfolioItems).set({ aiDescription: item.aiDescription }).where(eq(schema.portfolioItems.id, item.id));
        }
        const text = [item.title, item.notes, item.aiDescription].filter(Boolean).join('\n');
        if (text) docs.push({ content: `Portfolio: ${text}`, sourceType: 'portfolio', assetId: asset.id });
        if (asset.mimeType === 'text/plain' || asset.mimeType === 'text/markdown') {
          docs.push({ content: (await p.storage.get(asset.s3Key)).toString('utf8'), sourceType: 'brief', assetId: asset.id });
        }
      }

      // 2. Website copy.
      if (company.websiteUrl) {
        try {
          const pages = await p.research.extract([company.websiteUrl]);
          for (const page of pages) docs.push({ content: page.content, sourceType: 'website' });
        } catch (e) {
          log(`website extract skipped: ${(e as Error).message}`);
        }
      }

      // 3. What the operator told us.
      const brand = await currentBrand(db, companyId);
      docs.push({ content: brandBrief({ company, brand, memories: [] }), sourceType: 'brief' });

      // Embed, replacing this company's previous memory so retraining never duplicates.
      const chunks = docs.flatMap((doc) => chunkText(doc.content).map((content) => ({ ...doc, content })));
      const vectors = await p.embeddings.embed(chunks.map((c) => c.content));
      await db.delete(schema.knowledgeChunks).where(eq(schema.knowledgeChunks.companyId, companyId));
      for (let i = 0; i < chunks.length; i += 50) {
        await db.insert(schema.knowledgeChunks).values(
          chunks.slice(i, i + 50).map((c, j) => ({
            companyId,
            trainingRunId: training.id,
            sourceAssetId: c.assetId,
            sourceType: c.sourceType,
            content: c.content,
            embedding: vectors[i + j],
          })),
        );
      }
      await db.update(schema.trainingRuns).set({ chunksIndexed: chunks.length }).where(eq(schema.trainingRuns.id, training.id));
      log(`indexed ${chunks.length} chunks from ${docs.length} documents`);
      return { next: 'synthesize' };
    },

    async synthesize({ db, providers: p, run, state, addCost }) {
      const companyId = run.companyId!;
      const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId));
      const brand = await currentBrand(db, companyId);
      const memories = await db
        .select({ content: schema.knowledgeChunks.content })
        .from(schema.knowledgeChunks)
        .where(eq(schema.knowledgeChunks.companyId, companyId))
        .limit(60);
      const res = await p.llm.structured({
        system: BRAND_STRATEGIST,
        prompt: `${brandBrief({ company, brand, memories: memories.map((m) => m.content) })}

Write ${company.name}'s brand bible for TikTok content. Keep every fact the operator provided (colours, tone, values); refine and extend them, don't contradict them.`,
        schema: bibleSchema,
        effort: 'high',
        mock: () => ({
          brandSummary: `## ${company.name}\n${company.description ?? 'A modern brand.'}\n\nWarm, confident, helpful. Show real people and real products.`,
          toneOfVoice: brand?.toneOfVoice || 'Warm, confident and playful',
          brandValues: brand?.brandValues.length ? brand.brandValues : ['Quality', 'Community'],
          usp: brand?.usp || `${company.name} makes it easy.`,
          targetAudience: brand?.targetAudience || 'Urban 18-34 year olds',
          dos: ['Show the product in the first second', 'Use on-screen captions'],
          donts: ['Stock-footage look', 'Unverified claims'],
          suggestedPrimaryColors: ['#0F766E'],
        }),
      });
      addCost(res.costCents);
      const bible = res.data;
      const hex = (list: string[]) => list.map((c) => c.toUpperCase()).filter((c) => /^#[0-9A-F]{6}$/.test(c));

      // New version; previous ones stay for history.
      const [{ max }] = await db
        .select({ max: sql<number>`coalesce(max(${schema.brandProfiles.version}), 0)` })
        .from(schema.brandProfiles)
        .where(eq(schema.brandProfiles.companyId, companyId));
      await db
        .update(schema.brandProfiles)
        .set({ isCurrent: false })
        .where(and(eq(schema.brandProfiles.companyId, companyId), eq(schema.brandProfiles.isCurrent, true)));
      const [profile] = await db
        .insert(schema.brandProfiles)
        .values({
          companyId,
          version: Number(max) + 1,
          isCurrent: true,
          primaryColors: brand?.primaryColors.length ? brand.primaryColors : hex(bible.suggestedPrimaryColors).slice(0, 3),
          secondaryColors: brand?.secondaryColors ?? [],
          fonts: brand?.fonts ?? [],
          logoAssetId: brand?.logoAssetId,
          toneOfVoice: bible.toneOfVoice,
          brandValues: bible.brandValues,
          usp: bible.usp,
          targetAudience: bible.targetAudience,
          competitors: brand?.competitors ?? [],
          dos: bible.dos,
          donts: bible.donts,
          brandSummary: bible.brandSummary,
        })
        .returning();
      await db
        .update(schema.trainingRuns)
        .set({ status: 'succeeded', brandProfileId: profile.id, finishedAt: new Date() })
        .where(eq(schema.trainingRuns.id, state.trainingRunId as string));
      await db.update(schema.companies).set({ status: 'active' }).where(eq(schema.companies.id, companyId));
      return { done: true, output: { brandProfileId: profile.id, version: profile.version } };
    },
  },
};
