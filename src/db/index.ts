import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { env } from '@/env';
import * as schema from './schema';

export { schema };
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

let instance: Promise<Db> | undefined;

/**
 * Neon in production (`postgres://...`), or an embedded Postgres when DATABASE_URL is
 * `pglite:<dir>` / `pglite:memory`, so the whole app runs locally before Neon is set up.
 */
export function db(): Promise<Db> {
  instance ??= connect(env().DATABASE_URL);
  return instance;
}

/** Tests inject their own database. */
export function setDb(next: Db | undefined) {
  instance = next ? Promise.resolve(next) : undefined;
}

async function connect(url: string): Promise<Db> {
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
  const pg = new PGlite(dataDir ? path.resolve(dataDir) : undefined, { extensions: { vector } });
  const { rows } = await pg.query<{ exists: boolean }>(
    `SELECT to_regclass('public.companies') IS NOT NULL AS exists`,
  );
  if (!rows[0]?.exists) await pg.exec(await readSchemaSql());
  return pg;
}

export function readSchemaSql() {
  return readFile(path.join(process.cwd(), 'db/schema.sql'), 'utf8');
}
