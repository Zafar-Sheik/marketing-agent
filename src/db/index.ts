import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { env } from '@/env';
import * as schema from './schema';

export { schema };
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

// Kept on globalThis: Next.js may load this module more than once per process (route handlers
// and pages are bundled separately), and two embedded databases on one directory diverge.
const g = globalThis as unknown as { __marketingAgentDb?: Promise<Db> };

/**
 * Neon in production (`postgres://...`), or an embedded Postgres when DATABASE_URL is
 * `pglite:<dir>` / `pglite:memory`, so the whole app runs locally before Neon is set up.
 */
export function db(): Promise<Db> {
  g.__marketingAgentDb ??= connect(env().DATABASE_URL);
  return g.__marketingAgentDb;
}

/** Tests inject their own database. */
export function setDb(next: Db | undefined) {
  g.__marketingAgentDb = next ? Promise.resolve(next) : undefined;
}

async function connect(url: string): Promise<Db> {
  if (url.startsWith('pglite:') && process.env.VERCEL) {
    // Serverless file systems are read-only and short-lived: the embedded database can't work there.
    throw new Error('DATABASE_URL is not set. Add your Neon connection string in Vercel > Settings > Environment Variables.');
  }
  if (url.startsWith('pglite:')) {
    const target = url.slice('pglite:'.length);
    const pg = await createPglite(target === 'memory' ? undefined : target);
    const { drizzle } = await import('drizzle-orm/pglite');
    return drizzle(pg, { schema }) as unknown as Db;
  }
  const { Pool } = await import('@neondatabase/serverless');
  const { drizzle } = await import('drizzle-orm/neon-serverless');
  return drizzle(new Pool({ connectionString: url }), { schema }) as unknown as Db;
}

export async function createPglite(dataDir?: string) {
  const { PGlite } = await import('@electric-sql/pglite');
  const { vector } = await import('@electric-sql/pglite-pgvector');
  if (dataDir) await mkdir(path.resolve(dataDir), { recursive: true });
  // Pass options as the only argument when in-memory: PGlite ignores them after an undefined dataDir.
  const pg = dataDir
    ? new PGlite(path.resolve(dataDir), { extensions: { vector } })
    : new PGlite({ extensions: { vector } });
  const { rows } = await pg.query<{ exists: boolean }>(
    `SELECT to_regclass('public.companies') IS NOT NULL AS exists`,
  );
  if (!rows[0]?.exists) await pg.exec(await readSchemaSql());
  return pg;
}

export function readSchemaSql() {
  return readFile(path.join(process.cwd(), 'db/schema.sql'), 'utf8');
}
