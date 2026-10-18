// Loads db/schema.sql into a real Postgres engine (PGlite + pgvector), checks
// that docs/03-erd.md matches it exactly, and walks one client through the full
// monthly lifecycle to prove the constraints allow the happy path and block the
// mistakes that would cost a client money.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';

const root = new URL('..', import.meta.url);
const schemaSql = await readFile(new URL('db/schema.sql', root), 'utf8');
const erdMd = await readFile(new URL('docs/03-erd.md', root), 'utf8');
const erd = erdMd.match(/```mermaid\n(erDiagram[\s\S]*?)```/)[1];

let db;
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const rejects = (sql, params, pattern) => assert.rejects(db.query(sql, params), pattern);

before(async () => {
  db = new PGlite({ extensions: { vector } });
  await db.exec(schemaSql);
});
after(() => db?.close());

// ---------------------------------------------------------------------------
// ERD <-> schema consistency
// ---------------------------------------------------------------------------
const erdEntities = new Set([...erd.matchAll(/^\s{4}(\w+) \{$/gm)].map((m) => m[1]));
const erdRelations = [...erd.matchAll(/^\s{4}(\w+) [|o}{]{2}--[|o}{]{2} (\w+) :/gm)].map((m) => [m[1], m[2]]);

test('ERD draws every table and only real tables', async () => {
  const { rows } = await db.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  );
  const tables = new Set(rows.map((r) => r.table_name));
  assert.deepEqual([...erdEntities].sort(), [...tables].sort());
});

test('every ERD relationship is a real foreign key', async () => {
  const { rows } = await db.query(`
    SELECT DISTINCT tc.table_name AS child, ccu.table_name AS parent
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'`);
  const fks = new Set(rows.map((r) => `${r.child}->${r.parent}`));
  assert.ok(erdRelations.length > 40, `parsed only ${erdRelations.length} relationships`);
  for (const [a, b] of erdRelations) {
    assert.ok(fks.has(`${a}->${b}`) || fks.has(`${b}->${a}`), `ERD shows ${a} — ${b} but no FK exists`);
  }
});

test('every ERD attribute is a real column', async () => {
  const { rows } = await db.query(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
  );
  const cols = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
  for (const block of erd.matchAll(/^\s{4}(\w+) \{\n([\s\S]*?)^\s{4}\}/gm)) {
    for (const line of block[2].trim().split('\n')) {
      const column = line.trim().split(/\s+/)[1];
      assert.ok(cols.has(`${block[1]}.${column}`), `ERD attribute ${block[1]}.${column} not in schema`);
    }
  }
});

// ---------------------------------------------------------------------------
// Lifecycle: onboard -> train -> goals -> research -> plan -> create -> ads -> post -> report
// ---------------------------------------------------------------------------
const ids = {};

test('onboard a client with brand, portfolio and TikTok connection', async () => {
  ids.user = (await one(`INSERT INTO users (email, name) VALUES ('ops@agency.test', 'Ops') RETURNING id`)).id;
  ids.ws = (await one(`INSERT INTO workspaces (name, slug) VALUES ('Agency', 'agency') RETURNING id`)).id;
  await db.query(`INSERT INTO workspace_members VALUES ($1, $2, 'owner')`, [ids.ws, ids.user]);
  ids.company = (
    await one(
      `INSERT INTO companies (workspace_id, name, slug, industry, currency, monthly_ad_budget_cents, created_by)
       VALUES ($1, 'Kauai Cafe', 'kauai-cafe', 'Food & Beverage', 'ZAR', 1500000, $2) RETURNING id`,
      [ids.ws, ids.user],
    )
  ).id;
  ids.asset = (
    await one(
      `INSERT INTO assets (workspace_id, company_id, kind, s3_bucket, s3_key, mime_type, bytes)
       VALUES ($1, $2, 'image', 'bucket', 'companies/kauai/portfolio/1.jpg', 'image/jpeg', 2048) RETURNING id`,
      [ids.ws, ids.company],
    )
  ).id;
  await db.query(`INSERT INTO portfolio_items (company_id, asset_id, title) VALUES ($1, $2, 'Menu shoot')`, [
    ids.company,
    ids.asset,
  ]);
  ids.brand = (
    await one(
      `INSERT INTO brand_profiles (company_id, version, is_current, primary_colors, tone_of_voice)
       VALUES ($1, 1, true, '{#0F766E,#F59E0B}', 'Warm, playful') RETURNING id`,
      [ids.company],
    )
  ).id;
  await db.query(
    `INSERT INTO tiktok_connections (company_id, advertiser_id, access_token_enc, scopes) VALUES ($1, '7000', 'enc', '{ad.manage}')`,
    [ids.company],
  );
});

test('brand colours must be hex and only one profile is current', async () => {
  await rejects(
    `INSERT INTO brand_profiles (company_id, version, primary_colors) VALUES ($1, 9, '{teal}')`,
    [ids.company],
    /brand_colors_hex/,
  );
  await rejects(
    `INSERT INTO brand_profiles (company_id, version, is_current) VALUES ($1, 2, true)`,
    [ids.company],
    /brand_profiles_one_current/,
  );
});

test('training stores embeddings and similarity search returns the closest chunk', async () => {
  ids.training = (
    await one(`INSERT INTO training_runs (company_id, brand_profile_id, status) VALUES ($1, $2, 'succeeded') RETURNING id`, [
      ids.company,
      ids.brand,
    ])
  ).id;
  const vec = (hot) => `[${Array.from({ length: 1536 }, (_, i) => (i === hot ? 1 : 0)).join(',')}]`;
  for (const [hot, content] of [[0, 'Smoothies and wraps'], [1, 'Founded in 1996'], [2, 'Teal and amber palette']]) {
    await db.query(
      `INSERT INTO knowledge_chunks (company_id, training_run_id, source_asset_id, source_type, content, embedding)
       VALUES ($1, $2, $3, 'portfolio', $4, $5)`,
      [ids.company, ids.training, ids.asset, content, vec(hot)],
    );
  }
  const nearest = await one(
    `SELECT content FROM knowledge_chunks WHERE company_id = $1 ORDER BY embedding <=> $2 LIMIT 1`,
    [ids.company, vec(2)],
  );
  assert.equal(nearest.content, 'Teal and amber palette');
  await db.query(`UPDATE companies SET status = 'active' WHERE id = $1`, [ids.company]);
});

test('monthly goals: one per company per month, month must be the 1st', async () => {
  ids.goal = (
    await one(
      `INSERT INTO monthly_goals (company_id, month, prompt, ad_budget_cents, kpis, locations)
       VALUES ($1, '2026-11-01', 'Launch summer menu, +20% followers', 1500000, '[{"metric":"followers","target":0.2}]', '{ZA}')
       RETURNING id`,
      [ids.company],
    )
  ).id;
  await rejects(
    `INSERT INTO monthly_goals (company_id, month, prompt, ad_budget_cents) VALUES ($1, '2026-11-01', 'dup', 0)`,
    [ids.company],
    /unique/i,
  );
  await rejects(
    `INSERT INTO monthly_goals (company_id, month, prompt, ad_budget_cents) VALUES ($1, '2026-12-15', 'x', 0)`,
    [ids.company],
    /check/i,
  );
  await rejects(
    `INSERT INTO monthly_goals (company_id, month, prompt, ad_budget_cents) VALUES ($1, '2027-01-01', 'x', -1)`,
    [ids.company],
    /check/i,
  );
});

test('research -> versioned plan -> calendar items -> weekly request', async () => {
  ids.research = (
    await one(`INSERT INTO research_reports (company_id, monthly_goal_id, status) VALUES ($1, $2, 'succeeded') RETURNING id`, [
      ids.company,
      ids.goal,
    ])
  ).id;
  ids.segment = (
    await one(
      `INSERT INTO audience_segments (company_id, research_report_id, name, age_groups, genders, location_ids, rationale)
       VALUES ($1, $2, 'Young urban foodies', '{AGE_18_24,AGE_25_34}', '{GENDER_UNLIMITED}', '{1000001}', 'Highest engagement in research')
       RETURNING id`,
      [ids.company, ids.research],
    )
  ).id;
  const plan = `INSERT INTO marketing_plans (company_id, monthly_goal_id, research_report_id, brand_profile_id, version, status)
                VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`;
  await db.query(plan, [ids.company, ids.goal, ids.research, ids.brand, 1, 'changes_requested']);
  ids.plan = (await one(plan, [ids.company, ids.goal, ids.research, ids.brand, 2, 'approved'])).id;
  await rejects(plan, [ids.company, ids.goal, ids.research, ids.brand, 2, 'draft'], /unique/i);

  ids.request = (
    await one(
      `INSERT INTO content_requests (company_id, marketing_plan_id, week_start, format, prompt, is_paid)
       VALUES ($1, $2, '2026-11-02', 'short_video', '15s 2-for-1 Friday deal', true) RETURNING id`,
      [ids.company, ids.plan],
    )
  ).id;
  await rejects(
    `INSERT INTO content_requests (company_id, week_start, format, prompt) VALUES ($1, '2026-11-04', 'short_video', 'x')`,
    [ids.company],
    /check/i,
  );
  ids.item = (
    await one(
      `INSERT INTO plan_items (marketing_plan_id, content_request_id, scheduled_for, format, objective, brief, is_paid, planned_spend_cents)
       VALUES ($1, $2, '2026-11-06 17:00+02', 'short_video', 'conversions', 'Friday deal', true, 300000) RETURNING id`,
      [ids.plan, ids.request],
    )
  ).id;
});

test('creative with regeneration lineage and S3 renders', async () => {
  const insert = `INSERT INTO creatives (company_id, plan_item_id, brand_profile_id, parent_creative_id, format, status, brand_score)
                  VALUES ($1, $2, $3, $4, 'short_video', $5, $6) RETURNING id`;
  const v1 = (await one(insert, [ids.company, ids.item, ids.brand, null, 'changes_requested', 0.82])).id;
  ids.creative = (await one(insert, [ids.company, ids.item, ids.brand, v1, 'approved', 0.91])).id;
  await rejects(insert, [ids.company, ids.item, ids.brand, null, 'approved', 1.5], /check/i);
  const render = (
    await one(
      `INSERT INTO assets (workspace_id, company_id, kind, s3_bucket, s3_key, mime_type, bytes, width, height, duration_ms)
       VALUES ($1, $2, 'video', 'bucket', 'companies/kauai/creatives/final.mp4', 'video/mp4', 9000000, 1080, 1920, 15000) RETURNING id`,
      [ids.ws, ids.company],
    )
  ).id;
  await db.query(`INSERT INTO creative_assets (creative_id, asset_id, role, provider) VALUES ($1, $2, 'final', 'creatomate')`, [
    ids.creative,
    render,
  ]);
  await rejects(
    `INSERT INTO assets (workspace_id, kind, s3_bucket, s3_key, mime_type, bytes) VALUES ($1, 'video', 'bucket', 'companies/kauai/creatives/final.mp4', 'video/mp4', 1)`,
    [ids.ws],
    /unique/i,
  );
});

test('paid: campaign -> ad group -> ad -> daily metrics, creative with spend cannot be deleted', async () => {
  const campaign = (
    await one(
      `INSERT INTO ad_campaigns (company_id, marketing_plan_id, name, objective, budget_cents, status, starts_at, ends_at)
       VALUES ($1, $2, 'Nov - Friday deal', 'CONVERSIONS', 300000, 'active', '2026-11-06', '2026-11-30') RETURNING id`,
      [ids.company, ids.plan],
    )
  ).id;
  await rejects(
    `INSERT INTO ad_campaigns (company_id, name, objective, budget_cents, starts_at, ends_at) VALUES ($1, 'x', 'REACH', 1, '2026-11-30', '2026-11-01')`,
    [ids.company],
    /check/i,
  );
  const group = (
    await one(
      `INSERT INTO ad_groups (ad_campaign_id, audience_segment_id, name, optimization_goal, daily_budget_cents, targeting_snapshot)
       VALUES ($1, $2, 'Foodies 18-34', 'CONVERT', 12000, '{"age_groups":["AGE_18_24"]}') RETURNING id`,
      [campaign, ids.segment],
    )
  ).id;
  const ad = (
    await one(`INSERT INTO ads (ad_group_id, creative_id, ad_text, tiktok_ad_id) VALUES ($1, $2, '2-for-1 this Friday!', '1800') RETURNING id`, [
      group,
      ids.creative,
    ])
  ).id;
  await db.query(`INSERT INTO ad_metrics_daily (ad_id, date, spend_cents, impressions, clicks) VALUES ($1, '2026-11-06', 11950, 40000, 900)`, [ad]);
  await rejects(`INSERT INTO ad_metrics_daily (ad_id, date) VALUES ($1, '2026-11-06')`, [ad], /duplicate key/i);
  await rejects(`DELETE FROM creatives WHERE id = $1`, [ids.creative], /foreign key/i);
});

test('organic post, logo request, report, approvals and idempotent agent runs', async () => {
  const post = (
    await one(
      `INSERT INTO organic_posts (company_id, creative_id, scheduled_for, status, tiktok_post_id) VALUES ($1, $2, now(), 'published', '7300') RETURNING id`,
      [ids.company, ids.creative],
    )
  ).id;
  await db.query(`INSERT INTO post_metrics_daily (organic_post_id, date, views, likes) VALUES ($1, '2026-11-06', 12000, 800)`, [post]);

  const logo = (await one(`INSERT INTO logo_requests (company_id, prompt) VALUES ($1, 'Premium wordmark') RETURNING id`, [ids.company])).id;
  const concept = (
    await one(`INSERT INTO creatives (company_id, logo_request_id, format, status) VALUES ($1, $2, 'logo', 'approved') RETURNING id`, [
      ids.company,
      logo,
    ])
  ).id;
  await db.query(`UPDATE logo_requests SET selected_creative_id = $1, status = 'delivered' WHERE id = $2`, [concept, logo]);
  await rejects(`INSERT INTO logo_requests (company_id, prompt, concept_count) VALUES ($1, 'x', 50)`, [ids.company], /check/i);

  await db.query(
    `INSERT INTO approvals (company_id, subject_type, subject_id, decision, decided_by) VALUES ($1, 'marketing_plan', $2, 'approved', $3)`,
    [ids.company, ids.plan, ids.user],
  );
  await rejects(
    `INSERT INTO approvals (company_id, subject_type, subject_id) VALUES ($1, 'invoice', $2)`,
    [ids.company, ids.plan],
    /check/i,
  );

  await db.query(
    `INSERT INTO monthly_reports (company_id, marketing_plan_id, research_report_id, month, status) VALUES ($1, $2, $3, '2026-11-01', 'succeeded')`,
    [ids.company, ids.plan, ids.research],
  );
  await rejects(
    `INSERT INTO monthly_reports (company_id, month) VALUES ($1, '2026-11-01')`,
    [ids.company],
    /unique/i,
  );

  const run = `INSERT INTO agent_runs (company_id, workflow, idempotency_key) VALUES ($1, 'distribute', 'run-123')`;
  await db.query(run, [ids.company]);
  await rejects(run, [ids.company], /unique/i);
});

test('updated_at moves on update', async () => {
  const before = await one(`SELECT updated_at FROM companies WHERE id = $1`, [ids.company]);
  await new Promise((r) => setTimeout(r, 10));
  await db.query(`UPDATE companies SET description = 'Smoothies' WHERE id = $1`, [ids.company]);
  const afterRow = await one(`SELECT updated_at FROM companies WHERE id = $1`, [ids.company]);
  assert.ok(afterRow.updated_at > before.updated_at);
});

test('deleting a company with no live ads cascades its whole tree', async () => {
  const c = (
    await one(`INSERT INTO companies (workspace_id, name, slug) VALUES ($1, 'Temp', 'temp') RETURNING id`, [ids.ws])
  ).id;
  await db.query(`INSERT INTO brand_profiles (company_id, version, is_current) VALUES ($1, 1, true)`, [c]);
  await db.query(`INSERT INTO monthly_goals (company_id, month, prompt, ad_budget_cents) VALUES ($1, '2026-11-01', 'x', 0)`, [c]);
  await db.query(`DELETE FROM companies WHERE id = $1`, [c]);
  const left = await one(`SELECT count(*)::int AS n FROM monthly_goals WHERE company_id = $1`, [c]);
  assert.equal(left.n, 0);
});
