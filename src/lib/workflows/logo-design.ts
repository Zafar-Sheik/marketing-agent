import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@/db';
import { brandBrief, brandContext } from '@/lib/agents/context';
import { LOGO_DESIGNER } from '@/lib/agents/prompts';
import { attachToCreative, storeAsset } from '@/lib/assets';
import type { WorkflowDef } from '@/lib/engine/types';

const conceptsSchema = z.object({
  concepts: z.array(
    z.object({
      name: z.string(),
      imagePrompt: z.string().describe('Prompt for a flat vector-style logo, centred, plain background, no mockup'),
      palette: z.array(z.string()).describe('#RRGGBB'),
      typography: z.string(),
      rationale: z.string(),
    }),
  ),
});

/** Logo request -> N distinct concepts rendered as transparent PNGs, each a creative to review. */
export const logoDesign: WorkflowDef = {
  first: 'concepts',
  steps: {
    async concepts({ db, providers: p, run, state, addCost }) {
      const [request] = await db.select().from(schema.logoRequests).where(eq(schema.logoRequests.id, run.subjectId!));
      await db.update(schema.logoRequests).set({ status: 'in_production' }).where(eq(schema.logoRequests.id, request.id));
      const ctx = await brandContext(db, p, request.companyId, `logo identity ${request.prompt}`);
      const res = await p.llm.structured({
        system: LOGO_DESIGNER,
        prompt: `${brandBrief(ctx)}

<logo_request count="${request.conceptCount}" styles="${request.styles.join(', ') || 'designer’s choice'}">
${request.prompt}
</logo_request>

Create ${request.conceptCount} genuinely different concepts.`,
        schema: conceptsSchema,
        effort: 'high',
        mock: () => ({
          concepts: Array.from({ length: request.conceptCount }, (_, i) => ({
            name: ['Monogram', 'Wordmark', 'Emblem', 'Mascot', 'Abstract mark'][i % 5],
            imagePrompt: `Flat vector logo for ${ctx.company.name}, concept ${i + 1}`,
            palette: ctx.brand?.primaryColors.length ? ctx.brand.primaryColors : ['#0F766E'],
            typography: 'Geometric sans, bold',
            rationale: `Concept ${i + 1}: simple silhouette that reads at 32px.`,
          })),
        }),
      });
      addCost(res.costCents);
      state.concepts = res.data.concepts.slice(0, request.conceptCount);
      state.index = 0;
      return { next: 'render' };
    },

    /** One concept per step, so a slow image model never times out the whole request. */
    async render({ db, providers: p, run, state }) {
      const [request] = await db.select().from(schema.logoRequests).where(eq(schema.logoRequests.id, run.subjectId!));
      const concepts = state.concepts as z.infer<typeof conceptsSchema>['concepts'];
      const i = state.index as number;
      const c = concepts[i];
      const img = await p.images.generate(
        `${c.imagePrompt}. Palette ${c.palette.join(', ')}. ${c.typography}. Flat vector logo, centred, generous padding, transparent background, no mockup, no extra text.`,
        { size: '1024x1024', transparent: true },
      );
      const [creative] = await db
        .insert(schema.creatives)
        .values({
          companyId: request.companyId,
          logoRequestId: request.id,
          format: 'logo',
          status: 'in_review',
          concept: c.name,
          rationale: `${c.rationale}\n\nPalette: ${c.palette.join(', ')} · Type: ${c.typography}`,
        })
        .returning();
      const asset = await storeAsset(db, p, {
        companyId: request.companyId,
        key: `companies/${request.companyId}/logos/${request.id}/concept-${i + 1}`,
        bytes: img.bytes,
        mimeType: img.mimeType,
        kind: 'logo',
        width: 1024,
        height: 1024,
      });
      await attachToCreative(db, creative.id, asset.id, 'logo_png', 'openai');
      state.index = i + 1;
      if (i + 1 < concepts.length) return { next: 'render' };
      await db.update(schema.logoRequests).set({ status: 'delivered' }).where(eq(schema.logoRequests.id, request.id));
      return { done: true, output: { concepts: concepts.length } };
    },
  },
};
