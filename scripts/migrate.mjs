// Apply db/schema.sql (first run) and db/migrations/*.sql (once each) to Neon.
// Uses DATABASE_URL_UNPOOLED when set (recommended for DDL), else DATABASE_URL.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Pool } from '@neondatabase/serverless';

function loadDotEnv() {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

loadDotEnv();
const url = [process.env.DATABASE_URL_UNPOOLED, process.env.DATABASE_URL].find((u) => u && /^postgres(ql)?:\/\//.test(u));
if (!url) {
  console.log('No Postgres DATABASE_URL set: the app uses its embedded database, which creates itself. Nothing to migrate.');
  process.exit(0);
}

const pool = new Pool({ connectionString: url });
try {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const applied = new Set((await pool.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
  const { rows } = await pool.query(`SELECT to_regclass('public.companies') IS NOT NULL AS exists`);
  const steps = [];
  if (!applied.has('0001-schema')) {
    if (rows[0].exists) console.log('Tables already exist; recording the base schema as applied.');
    else steps.push(['0001-schema', readFileSync('db/schema.sql', 'utf8')]);
    if (rows[0].exists) await pool.query(`INSERT INTO schema_migrations (version) VALUES ('0001-schema')`);
  }
  for (const file of readdirSync('db/migrations').filter((f) => f.endsWith('.sql')).sort()) {
    const version = path.basename(file, '.sql');
    if (!applied.has(version)) steps.push([version, readFileSync(path.join('db/migrations', file), 'utf8')]);
  }
  for (const [version, sql] of steps) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      await client.query('COMMIT');
      console.log(`applied ${version}`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw new Error(`${version} failed: ${e.message}`);
    } finally {
      client.release();
    }
  }
  console.log(steps.length ? 'Database is up to date.' : 'Nothing to apply; database is up to date.');
} finally {
  await pool.end();
}
