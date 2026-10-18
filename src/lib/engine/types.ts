import type { Db } from '@/db';
import type { Providers } from '@/lib/providers';
import type { schema } from '@/db';

export type Run = typeof schema.agentRuns.$inferSelect;

export type StepResult =
  /** Continue with `next` (optionally after a durable wait in n8n). */
  | { next: string; waitSeconds?: number }
  | { done: true; output?: Record<string, unknown> };

export type StepContext = {
  run: Run;
  db: Db;
  providers: Providers;
  /** Input the run was started with. */
  input: Record<string, unknown>;
  /** Small JSON state kept across steps (pending job ids, attempt counters). */
  state: Record<string, unknown>;
  addCost(cents: number): void;
  log(message: string): void;
};

export type Step = (ctx: StepContext) => Promise<StepResult>;

export type WorkflowDef = {
  first: string;
  steps: Record<string, Step>;
};
