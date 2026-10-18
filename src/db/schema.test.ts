import { describe, it, expect, beforeAll } from 'vitest';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import * as schema from './schema';
import { freshDb } from '@/test/db';
import type { Db } from '.';

let db: Db;
beforeAll(async () => {
  db = await freshDb();
});

describe('Drizzle models match db/schema.sql', () => {
  it('has the same tables and columns as the real database', async () => {
    const rows = (await db.execute(
      sql`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
    )) as unknown as { rows: { table_name: string; column_name: string }[] };
    const dbCols = new Set(rows.rows.map((r) => `${r.table_name}.${r.column_name}`));
    const modelCols = new Set<string>();
    for (const value of Object.values(schema)) {
      if (!(value instanceof PgTable)) continue;
      const cfg = getTableConfig(value);
      for (const c of cfg.columns) modelCols.add(`${cfg.name}.${c.name}`);
    }
    expect([...modelCols].filter((c) => !dbCols.has(c))).toEqual([]);
    expect([...dbCols].filter((c) => !modelCols.has(c))).toEqual([]);
  });
});
