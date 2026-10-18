import { after } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { env } from '@/env';
import { providers } from '@/lib/providers';
import { sign } from '@/lib/crypto';
import { workflows, type WorkflowName } from './registry';
import type { Run, StepResult } from './types';

export type StartOptions = {
  companyId: string | null;
  subjectType?: string;
  subjectId?: string;
  input?: Record<string, unknown>;
  /** A second start with the same key returns the existing run instead of starting another. */
  idempotencyKey?: string;
  startAt?: string;
};

/** Record an agent run and hand it to n8n (or run it in-process when DISPATCH_MODE=inline). */
export async function startWorkflow(workflow: WorkflowName, opts: StartOptions): Promise<Run> {
  const d = await db();
  const def = workflows[workflow];
  const step = opts.startAt ?? def.first;
  if (!def.steps[step]) throw new Error(`Unknown step ${workflow}.${step}`);
  const [inserted] = await d
    .insert(schema.agentRuns)
    .values({
      companyId: opts.companyId,
      workflow,
      subjectType: opts.subjectType,
      subjectId: opts.subjectId,
      input: opts.input ?? {},
      output: { state: {}, step, log: [] },
      idempotencyKey: opts.idempotencyKey,
    })
    .onConflictDoNothing({ target: schema.agentRuns.idempotencyKey })
    .returning();
  if (!inserted) {
    const [existing] = await d.select().from(schema.agentRuns).where(eq(schema.agentRuns.idempotencyKey, opts.idempotencyKey!));
    return existing;
  }
  await dispatch(inserted.id, step);
  return inserted;
}

async function dispatch(runId: string, step: string) {
  if (env().DISPATCH_MODE === 'inline') {
    const job = () => driveInline(runId, step).catch((e) => console.error(`[run ${runId}]`, e));
    try {
      after(job); // inside a request: run after the response is sent
    } catch {
      void job(); // outside a request (tests, scripts)
    }
    return;
  }
  const body = JSON.stringify({ run_id: runId, step });
  const res = await fetch(`${env().N8N_BASE_URL}/webhook/agent-runner`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...sign(body) },
    body,
  });
  if (!res.ok) {
    await finish(runId, 'failed', `n8n rejected the job (${res.status}). Is the agent-runner workflow active?`);
  }
}

/** Seconds the in-process driver actually waits (n8n honours the real wait). */
let inlineWaitScale = 1;
export function setInlineWaitScale(scale: number) {
  inlineWaitScale = scale;
}

export async function driveInline(runId: string, step: string, maxSteps = 500) {
  let current: string | undefined = step;
  for (let i = 0; current && i < maxSteps; i++) {
    const result = await executeStep(runId, current);
    if ('done' in result) return;
    if (result.waitSeconds) await new Promise((r) => setTimeout(r, Math.min(result.waitSeconds! * 1000 * inlineWaitScale, 60_000)));
    current = result.next;
  }
}

/** Run one step of a run. Called by n8n through /api/internal/steps and by the inline driver. */
export async function executeStep(runId: string, stepName: string): Promise<StepResult> {
  const d = await db();
  const [run] = await d.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, runId));
  if (!run) throw new Error(`Run ${runId} not found`);
  if (run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled') return { done: true };
  const def = workflows[run.workflow as WorkflowName];
  const step = def?.steps[stepName];
  if (!step) {
    await finish(runId, 'failed', `Unknown step ${run.workflow}.${stepName}`);
    return { done: true };
  }

  const out = (run.output ?? {}) as { state?: Record<string, unknown>; log?: string[] };
  const state = out.state ?? {};
  const log = out.log ?? [];
  let cost = 0;
  await d
    .update(schema.agentRuns)
    .set({ status: 'running', startedAt: run.startedAt ?? new Date() })
    .where(eq(schema.agentRuns.id, runId));

  try {
    const result = await step({
      run,
      db: d,
      providers: providers(),
      input: run.input,
      state,
      addCost: (c) => (cost += c),
      log: (m) => log.push(`${new Date().toISOString()} ${stepName}: ${m}`),
    });
    const done = 'done' in result;
    await d
      .update(schema.agentRuns)
      .set({
        output: { ...out, ...(done ? result.output : {}), state, log: log.slice(-200), step: done ? null : result.next },
        costCents: sql`${schema.agentRuns.costCents} + ${cost}`,
        ...(done ? { status: 'succeeded' as const, finishedAt: new Date() } : {}),
      })
      .where(eq(schema.agentRuns.id, runId));
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.push(`${new Date().toISOString()} ${stepName}: FAILED ${message}`);
    await d
      .update(schema.agentRuns)
      .set({
        output: { ...out, state, log: log.slice(-200) },
        costCents: sql`${schema.agentRuns.costCents} + ${cost}`,
      })
      .where(eq(schema.agentRuns.id, runId));
    await finish(runId, 'failed', message);
    await onRunFailed(run, message);
    return { done: true };
  }
}

async function finish(runId: string, status: 'failed' | 'succeeded', error?: string) {
  await (await db())
    .update(schema.agentRuns)
    .set({ status, error, finishedAt: new Date() })
    .where(and(eq(schema.agentRuns.id, runId)));
}

/** Reflect a failed run on the thing it was working on, so the UI can offer "Retry". */
async function onRunFailed(run: Run, message: string) {
  const d = await db();
  if (run.subjectType === 'creative' && run.subjectId) {
    await d.update(schema.creatives).set({ status: 'failed', feedback: message }).where(eq(schema.creatives.id, run.subjectId));
  }
  if (run.subjectType === 'company' && run.workflow === 'brand-training' && run.subjectId) {
    await d.update(schema.companies).set({ status: 'draft' }).where(eq(schema.companies.id, run.subjectId));
  }
}
