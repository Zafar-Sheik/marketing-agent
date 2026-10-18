import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import { sign } from '@/lib/crypto';
import { setup, seedCompany, idle } from '@/test/fixtures';
import { startWorkflow } from '@/lib/engine/runs';
import { POST as steps } from './steps/route';
import { POST as cron } from './cron/[job]/route';

let db: Db;
beforeEach(async () => {
  ({ db } = await setup());
});

function signed(url: string, body: unknown, headers?: Record<string, string>) {
  const raw = JSON.stringify(body);
  return new Request(url, { method: 'POST', body: raw, headers: { 'content-type': 'application/json', ...sign(raw), ...headers } });
}

describe('/api/internal/steps (called by n8n)', () => {
  it('rejects unsigned and forged requests', async () => {
    const res = await steps(new Request('http://x/api/internal/steps', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(401);
    const forged = await steps(signed('http://x', { run_id: crypto.randomUUID(), step: 'sync' }, { 'X-Signature': 'sha256=00' }));
    expect(forged.status).toBe(401);
  });

  it('runs one step and tells n8n what is next', async () => {
    const { company, plan } = await seedCompany(db);
    process.env.DISPATCH_MODE = 'n8n';
    const { resetEnv } = await import('@/env');
    resetEnv();
    // Pretend n8n accepted the job; we drive the steps exactly like the agent-runner does.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(null, { status: 202 })) as typeof fetch;
    try {
      const [item] = await db.insert(schema.planItems).values({ marketingPlanId: plan.id, scheduledFor: new Date(), format: 'short_video', objective: 'awareness', brief: 'x' }).returning();
      const [creative] = await db.insert(schema.creatives).values({ companyId: company.id, planItemId: item.id, format: 'short_video' }).returning();
      const run = await startWorkflow('creative-production', { companyId: company.id, subjectType: 'creative', subjectId: creative.id });
      let step: string | undefined = 'concept';
      const seen: string[] = [];
      while (step) {
        seen.push(step);
        const res = await steps(signed('http://x/api/internal/steps', { run_id: run.id, step }));
        expect(res.status).toBe(200);
        const body = (await res.json()) as { done: boolean; next?: string; waitSeconds?: number };
        step = body.done ? undefined : body.next;
      }
      expect(seen).toEqual(['concept', 'frames', 'clips', 'render', 'rendered', 'qa']);
      const [after] = await db.select().from(schema.creatives).where(eq(schema.creatives.id, creative.id));
      expect(after.status).toBe('in_review');
    } finally {
      globalThis.fetch = realFetch;
      process.env.DISPATCH_MODE = 'inline';
      resetEnv();
    }
  });
});

describe('/api/internal/cron (scheduled by n8n)', () => {
  it('produces due content for approved plans', async () => {
    const { plan } = await seedCompany(db);
    await db.insert(schema.planItems).values({ marketingPlanId: plan.id, scheduledFor: new Date(Date.now() + 86_400_000), format: 'short_video', objective: 'awareness', brief: 'tomorrow' });
    await db.insert(schema.planItems).values({ marketingPlanId: plan.id, scheduledFor: new Date(Date.now() + 40 * 86_400_000), format: 'short_video', objective: 'awareness', brief: 'too far ahead' });
    const res = await cron(signed('http://x/api/internal/cron/produce', {}), { params: Promise.resolve({ job: 'produce' }) });
    expect(await res.json()).toEqual({ started: 1 });
    await idle(db);
  });

  it('runs at most one optimisation per company per day', async () => {
    const { company } = await seedCompany(db);
    await db.insert(schema.adCampaigns).values({ companyId: company.id, name: 'c', objective: 'traffic', budgetCents: 100, status: 'active' });
    const call = () => cron(signed('http://x/api/internal/cron/optimise', {}), { params: Promise.resolve({ job: 'optimise' }) });
    await call();
    await call();
    await idle(db);
    expect(await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.workflow, 'optimise'))).toHaveLength(1);
  });

  it('404s unknown jobs', async () => {
    const res = await cron(signed('http://x/api/internal/cron/nope', {}), { params: Promise.resolve({ job: 'nope' }) });
    expect(res.status).toBe(404);
  });
});
