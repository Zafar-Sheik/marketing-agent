import { z } from 'zod';
import { executeStep } from '@/lib/engine/runs';
import { route, signedJson } from '@/lib/http';

export const maxDuration = 800; // long LLM steps on Vercel Pro/Fluid

const body = z.object({ run_id: z.string().uuid(), step: z.string().min(1) });

/**
 * n8n's agent-runner calls this for each step and gets back what to do next:
 * `{ done: true }` or `{ next, waitSeconds }`.
 */
export const POST = route(async (req: Request) => {
  const { run_id, step } = body.parse(await signedJson(req));
  const result = await executeStep(run_id, step);
  return 'done' in result ? { done: true } : { done: false, next: result.next, waitSeconds: result.waitSeconds ?? 0 };
});
