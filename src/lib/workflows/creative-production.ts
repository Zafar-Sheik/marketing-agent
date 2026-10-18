import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Db } from '@/db';
import { env } from '@/env';
import { brandBrief, brandContext, currentBrand } from '@/lib/agents/context';
import { BRAND_QA, CREATIVE_DIRECTOR } from '@/lib/agents/prompts';
import { attachToCreative, creativeFiles, storeAsset } from '@/lib/assets';
import { download, type Providers } from '@/lib/providers';
import { slideComposition, videoComposition, type BrandStyle } from '@/lib/media/renderscript';
import { requestApproval } from '@/lib/services/approvals';
import type { StepContext, WorkflowDef } from '@/lib/engine/types';

const MAX_ATTEMPTS = 3;
const MAX_POLLS = 120;

const conceptSchema = z.object({
  concept: z.string(),
  hook: z.string().describe('What happens/is said in the first 1-2 seconds'),
  script: z.string().describe('Full voice-over script; empty for silent image posts'),
  scenes: z.array(
    z.object({
      visualPrompt: z.string().describe('Image-generation prompt for this scene/slide, vertical 9:16, using the brand palette'),
      motion: z.string().describe('Camera/subject motion for video; empty for slides'),
      voiceover: z.string(),
      onScreenText: z.string().describe('Short caption, max 8 words'),
      body: z.string().describe('Supporting line for slides; empty for video'),
      durationSeconds: z.number().describe('5 or 10 for video scenes'),
    }),
  ),
  caption: z.string(),
  hashtags: z.array(z.string()),
  callToAction: z.string(),
  rationale: z.string().describe('Why these creative choices fit the brief, brand and research'),
});

const qaSchema = z.object({
  score: z.number().describe('0-1'),
  issues: z.array(z.string()),
  strengths: z.array(z.string()),
});

async function load(ctx: StepContext) {
  const creativeId = ctx.run.subjectId!;
  const [creative] = await ctx.db.select().from(schema.creatives).where(eq(schema.creatives.id, creativeId));
  if (!creative) throw new Error(`Creative ${creativeId} not found`);
  return creative;
}

async function briefFor(db: Db, creative: typeof schema.creatives.$inferSelect) {
  if (creative.planItemId) {
    const [item] = await db.select().from(schema.planItems).where(eq(schema.planItems.id, creative.planItemId));
    if (item) return { brief: item.brief, objective: item.objective, pillar: item.pillar, isPaid: item.isPaid };
  }
  if (creative.contentRequestId) {
    const [req] = await db.select().from(schema.contentRequests).where(eq(schema.contentRequests.id, creative.contentRequestId));
    if (req) return { brief: req.prompt, objective: req.isPaid ? 'traffic' : 'awareness', pillar: null, isPaid: req.isPaid };
  }
  return { brief: creative.concept ?? 'Brand awareness post', objective: 'awareness', pillar: null, isPaid: false };
}

async function brandStyle(db: Db, p: Providers, companyId: string): Promise<BrandStyle> {
  const current = await currentBrand(db, companyId);
  let logoUrl: string | undefined;
  if (current?.logoAssetId) {
    const [logo] = await db.select().from(schema.assets).where(eq(schema.assets.id, current.logoAssetId));
    if (logo) logoUrl = await p.storage.presignGet(logo.s3Key, 6 * 3600);
  }
  return {
    primary: current?.primaryColors[0] ?? '#111827',
    secondary: current?.primaryColors[1] ?? current?.secondaryColors[0],
    headingFont: current?.fonts.find((f) => f.role === 'heading')?.family ?? 'Montserrat',
    bodyFont: current?.fonts.find((f) => f.role === 'body')?.family ?? 'Inter',
    logoUrl,
  };
}

const keyBase = (c: { companyId: string; id: string }) => `companies/${c.companyId}/creatives/${c.id}`;

/** One creative (video, image post or carousel) from brief to brand-checked files. */
export const creativeProduction: WorkflowDef = {
  first: 'concept',
  steps: {
    async concept(ctx) {
      const { db, providers: p, state, addCost } = ctx;
      const creative = await load(ctx);
      const { brief, objective, pillar, isPaid } = await briefFor(db, creative);
      const brand = await brandContext(db, p, creative.companyId, brief);
      state.attempt = ((state.attempt as number) ?? 0) + 1;
      await db.update(schema.creatives).set({ status: 'generating', brandProfileId: brand.brand?.id }).where(eq(schema.creatives.id, creative.id));

      const isVideo = creative.format === 'short_video' || creative.format === 'spark_ad' || creative.format === 'in_feed_ad';
      const shape = isVideo
        ? 'a 15-30 second vertical video in 3-5 scenes of 5 seconds (10 only if needed)'
        : creative.format === 'carousel'
          ? 'a photo carousel of 4-7 slides that tells a story and ends with the call to action'
          : 'a single striking image post';
      const qaIssues = (state.qaIssues as string[] | undefined) ?? [];
      const res = await p.llm.structured({
        system: CREATIVE_DIRECTOR,
        prompt: `${brandBrief(brand)}

<brief objective="${objective}"${pillar ? ` pillar="${pillar}"` : ''}${isPaid ? ' placement="paid ad"' : ''}>
${brief}
</brief>
${creative.feedback ? `<client_feedback>\n${creative.feedback}\n</client_feedback>` : ''}
${qaIssues.length ? `<brand_review_issues>\nThe previous version was rejected by brand review:\n- ${qaIssues.join('\n- ')}\n</brand_review_issues>` : ''}

Create ${shape}. Visual prompts must describe real-looking scenes in the brand palette (${brand.brand?.primaryColors.join(', ') || 'brand colours'}) with no text rendered in the image; on-screen text is added in editing.`,
        schema: conceptSchema,
        effort: 'high',
        mock: () => ({
          concept: `Product-first story for: ${brief.slice(0, 80)}`,
          hook: 'POV: you just found your new favourite spot',
          script: isVideo ? 'You walk in. You smell it. One bite and you are hooked. Come find out why.' : '',
          scenes: Array.from({ length: isVideo ? 3 : creative.format === 'carousel' ? 4 : 1 }, (_, i) => ({
            visualPrompt: `Scene ${i + 1}: close-up of the product, warm light, brand colours`,
            motion: isVideo ? 'slow push-in' : '',
            voiceover: isVideo ? `Line ${i + 1}` : '',
            onScreenText: ['Wait for it…', 'Made fresh daily', 'Come say hi'][i % 3],
            body: isVideo ? '' : 'Tap to see more',
            durationSeconds: 5,
          })),
          caption: 'Your new favourite. 📍',
          hashtags: ['#fyp', '#foodtok', '#localgem'],
          callToAction: 'Visit us today',
          rationale: 'Leads with the product, uses the trending POV hook from research.',
        }),
      });
      addCost(res.costCents);
      const c = res.data;
      await db
        .update(schema.creatives)
        .set({
          concept: c.concept,
          hook: c.hook,
          script: c.script,
          storyboard: c.scenes.map((s, i) => ({
            scene: i + 1,
            visual: s.visualPrompt,
            voiceover: s.voiceover,
            onScreenText: s.onScreenText,
            durationMs: (s.durationSeconds >= 8 ? 10 : 5) * 1000,
          })),
          caption: c.caption,
          hashtags: c.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).slice(0, 8),
          callToAction: c.callToAction,
          rationale: c.rationale,
        })
        .where(eq(schema.creatives.id, creative.id));
      state.scenes = c.scenes;
      return { next: isVideo ? 'frames' : 'slides' };
    },

    /** Key frame per scene, then start an image-to-video job for each, plus the voice-over. */
    async frames(ctx) {
      const { db, providers: p, state } = ctx;
      const creative = await load(ctx);
      const scenes = state.scenes as z.infer<typeof conceptSchema>['scenes'];
      const jobs: { scene: number; jobId: string }[] = [];
      for (const [i, scene] of scenes.entries()) {
        const img = await p.images.generate(`${scene.visualPrompt}. Vertical 9:16 photo, no text, no watermark.`, { size: '1024x1536' });
        const asset = await storeAsset(db, p, { companyId: creative.companyId, key: `${keyBase(creative)}/v${state.attempt}/frame-${i + 1}`, bytes: img.bytes, mimeType: img.mimeType, width: 1024, height: 1536 });
        await attachToCreative(db, creative.id, asset.id, 'frame', 'openai');
        const job = await p.video.start({
          imageUrl: await p.storage.presignGet(asset.s3Key, 3600),
          prompt: `${scene.motion}. ${scene.visualPrompt}`,
          durationSeconds: scene.durationSeconds >= 8 ? 10 : 5,
        });
        jobs.push({ scene: i, jobId: job.jobId });
      }
      if (creative.script) {
        const vo = await p.voice.speak(creative.script);
        const asset = await storeAsset(db, p, { companyId: creative.companyId, key: `${keyBase(creative)}/v${state.attempt}/voiceover`, bytes: vo.bytes, mimeType: vo.mimeType });
        await attachToCreative(db, creative.id, asset.id, 'voiceover', 'elevenlabs');
        state.voiceoverKey = asset.s3Key;
      }
      state.videoJobs = jobs;
      state.polls = 0;
      return { next: 'clips', waitSeconds: 20 };
    },

    async clips(ctx) {
      const { db, providers: p, state } = ctx;
      const creative = await load(ctx);
      const jobs = state.videoJobs as { scene: number; jobId: string; key?: string }[];
      for (const job of jobs.filter((j) => !j.key)) {
        const status = await p.video.get(job.jobId);
        if (status.status === 'failed') throw new Error(`Video generation failed for scene ${job.scene + 1}: ${status.error}`);
        if (status.status === 'succeeded' && status.url) {
          const file = await download(status.url);
          const asset = await storeAsset(db, p, { companyId: creative.companyId, key: `${keyBase(creative)}/v${state.attempt}/clip-${job.scene + 1}`, bytes: file.bytes, mimeType: file.mimeType });
          await attachToCreative(db, creative.id, asset.id, 'clip', 'runway', job.jobId);
          job.key = asset.s3Key;
        }
      }
      if (jobs.every((j) => j.key)) return { next: 'render' };
      state.polls = (state.polls as number) + 1;
      if ((state.polls as number) > MAX_POLLS) throw new Error('Video generation timed out.');
      return { next: 'clips', waitSeconds: 20 };
    },

    async render(ctx) {
      const { db, providers: p, state } = ctx;
      const creative = await load(ctx);
      const jobs = state.videoJobs as { scene: number; key: string }[];
      const scenes = state.scenes as z.infer<typeof conceptSchema>['scenes'];
      const source = videoComposition({
        scenes: await Promise.all(
          jobs.map(async (j) => ({
            clipUrl: await p.storage.presignGet(j.key, 6 * 3600),
            durationSeconds: scenes[j.scene].durationSeconds >= 8 ? 10 : 5,
            onScreenText: scenes[j.scene].onScreenText,
          })),
        ),
        voiceoverUrl: state.voiceoverKey ? await p.storage.presignGet(state.voiceoverKey as string, 6 * 3600) : undefined,
        callToAction: creative.callToAction ?? 'Learn more',
        brand: await brandStyle(db, p, creative.companyId),
      });
      state.renderJob = (await p.editor.render(source)).jobId;
      state.polls = 0;
      return { next: 'rendered', waitSeconds: 15 };
    },

    async rendered(ctx) {
      const { db, providers: p, state } = ctx;
      const creative = await load(ctx);
      const status = await p.editor.get(state.renderJob as string);
      if (status.status === 'failed') throw new Error(`Render failed: ${status.error}`);
      if (status.status === 'pending') {
        state.polls = (state.polls as number) + 1;
        if ((state.polls as number) > MAX_POLLS) throw new Error('Render timed out.');
        return { next: 'rendered', waitSeconds: 15 };
      }
      const file = await download(status.url!);
      const final = await storeAsset(db, p, { companyId: creative.companyId, key: `${keyBase(creative)}/v${state.attempt}/final`, bytes: file.bytes, mimeType: file.mimeType, width: 1080, height: 1920 });
      await attachToCreative(db, creative.id, final.id, 'final', 'creatomate', state.renderJob as string);
      return { next: 'qa' };
    },

    /** Image post / carousel: generated backgrounds composited with brand text. */
    async slides(ctx) {
      const { db, providers: p, state } = ctx;
      const creative = await load(ctx);
      const scenes = state.scenes as z.infer<typeof conceptSchema>['scenes'];
      const brand = await brandStyle(db, p, creative.companyId);
      const jobs: { index: number; jobId: string; key?: string }[] = [];
      for (const [i, s] of scenes.entries()) {
        const img = await p.images.generate(`${s.visualPrompt}. Vertical 9:16 photo, no text, no watermark.`, { size: '1024x1536' });
        const bg = await storeAsset(db, p, { companyId: creative.companyId, key: `${keyBase(creative)}/v${state.attempt}/background-${i + 1}`, bytes: img.bytes, mimeType: img.mimeType });
        await attachToCreative(db, creative.id, bg.id, 'frame', 'openai');
        const job = await p.editor.render(
          slideComposition({ backgroundUrl: await p.storage.presignGet(bg.s3Key, 6 * 3600), headline: s.onScreenText, body: s.body, brand, index: i, total: scenes.length }),
        );
        jobs.push({ index: i, jobId: job.jobId });
      }
      state.slideJobs = jobs;
      state.polls = 0;
      return { next: 'slides-rendered', waitSeconds: 10 };
    },

    async 'slides-rendered'(ctx) {
      const { db, providers: p, state } = ctx;
      const creative = await load(ctx);
      const jobs = state.slideJobs as { index: number; jobId: string; key?: string }[];
      for (const job of jobs.filter((j) => !j.key)) {
        const status = await p.editor.get(job.jobId);
        if (status.status === 'failed') throw new Error(`Slide ${job.index + 1} failed: ${status.error}`);
        if (status.status === 'succeeded') {
          const file = await download(status.url!);
          const asset = await storeAsset(db, p, { companyId: creative.companyId, key: `${keyBase(creative)}/v${state.attempt}/slide-${job.index + 1}`, bytes: file.bytes, mimeType: file.mimeType, width: 1080, height: 1920 });
          await attachToCreative(db, creative.id, asset.id, 'slide', 'creatomate', job.jobId);
          job.key = asset.s3Key;
        }
      }
      if (jobs.every((j) => j.key)) return { next: 'qa' };
      state.polls = (state.polls as number) + 1;
      if ((state.polls as number) > MAX_POLLS) throw new Error('Slide render timed out.');
      return { next: 'slides-rendered', waitSeconds: 10 };
    },

    /** Brand QA with vision. Below threshold: regenerate (max 3 attempts), then hand to the human. */
    async qa(ctx) {
      const { db, providers: p, state, addCost } = ctx;
      const creative = await load(ctx);
      const files = await creativeFiles(db, creative.id);
      const current = files.filter((f) => f.asset.s3Key.includes(`/v${state.attempt}/`));
      const stills = current.filter((f) => (f.role === 'slide' || f.role === 'frame') && f.asset.mimeType.startsWith('image/')).slice(0, 6);
      const brand = await brandContext(db, p, creative.companyId, creative.concept ?? '');
      const res = await p.llm.structured({
        system: BRAND_QA,
        prompt: `${brandBrief(brand)}

<content format="${creative.format}">
Hook: ${creative.hook}
Script: ${creative.script}
On-screen text: ${creative.storyboard.map((s) => s.onScreenText).join(' | ')}
Caption: ${creative.caption} ${creative.hashtags.join(' ')}
CTA: ${creative.callToAction}
</content>

The images are the key frames / slides in order. Score this content.`,
        images: await Promise.all(stills.map(async (f) => ({ url: await p.storage.presignGet(f.asset.s3Key, 3600) }))),
        schema: qaSchema,
        tier: 'smart',
        effort: 'medium',
        mock: () => ({ score: 0.86, issues: [], strengths: ['On palette', 'Clear hook'] }),
      });
      addCost(res.costCents);
      const score = Math.min(1, Math.max(0, res.data.score));
      const attempt = state.attempt as number;
      if (score < env().BRAND_SCORE_THRESHOLD && attempt < MAX_ATTEMPTS) {
        state.qaIssues = res.data.issues;
        await db.update(schema.creatives).set({ brandScore: score }).where(eq(schema.creatives.id, creative.id));
        ctx.log(`brand score ${score} below threshold, regenerating: ${res.data.issues.join('; ')}`);
        return { next: 'concept' };
      }
      await db
        .update(schema.creatives)
        .set({
          status: 'in_review',
          brandScore: score,
          feedback: res.data.issues.length ? `Brand review notes: ${res.data.issues.join('; ')}` : null,
        })
        .where(eq(schema.creatives.id, creative.id));
      await requestApproval(db, { companyId: creative.companyId, subjectType: 'creative', subjectId: creative.id });
      return { done: true, output: { score, attempts: attempt } };
    },
  },
};
