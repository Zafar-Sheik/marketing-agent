import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { agentRunner, scheduler, SIGN_JS, VERIFY_JS, NEXT_JS, CRON_SIGN_JS } from './build-n8n.mjs';

const require = createRequire(import.meta.url);
const SECRET = 'test-secret';
// Same scheme as src/lib/crypto.ts sign()/verify().
const appSign = (body, ts) => `sha256=${createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex')}`;
const run = (code, $json, extra = {}) => new Function('require', '$json', '$env', ...Object.keys(extra), code)(require, $json, { N8N_WEBHOOK_SECRET: SECRET }, ...Object.values(extra));

test('committed workflow files match the generator', () => {
  assert.deepEqual(JSON.parse(readFileSync('n8n/agent-runner.json', 'utf8')), JSON.parse(JSON.stringify(agentRunner)));
  assert.deepEqual(JSON.parse(readFileSync('n8n/scheduler.json', 'utf8')), JSON.parse(JSON.stringify(scheduler)));
});

test('every connection points at a node that exists', () => {
  for (const wf of [agentRunner, scheduler]) {
    const names = new Set(wf.nodes.map((n) => n.name));
    assert.equal(names.size, wf.nodes.length, 'node names are unique');
    for (const [from, { main }] of Object.entries(wf.connections)) {
      assert.ok(names.has(from), `${from} exists`);
      for (const out of main) for (const c of out) assert.ok(names.has(c.node), `${from} -> ${c.node}`);
    }
  }
});

test('agent runner loops: step -> wait -> step, and stops when done', () => {
  const c = agentRunner.connections;
  assert.deepEqual(c['Finished?'].main.map((o) => o[0]?.node), ['Done', 'Needs a wait?']);
  assert.deepEqual(c['Needs a wait?'].main.map((o) => o[0]?.node), ['Wait', 'Sign request']);
  assert.equal(c.Wait.main[0][0].node, 'Sign request');
  const webhook = agentRunner.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
  assert.equal(webhook.parameters.path, 'agent-runner'); // matches dispatch() in src/lib/engine/runs.ts
});

test('n8n accepts a job signed by the app', () => {
  const body = JSON.stringify({ run_id: 'r1', step: 'concept' });
  const ts = Math.floor(Date.now() / 1000);
  const out = run(VERIFY_JS, { headers: { 'x-signature': appSign(body, ts), 'x-timestamp': String(ts) }, body: JSON.parse(body) });
  assert.deepEqual(out.json, { run_id: 'r1', step: 'concept' });
});

test('n8n rejects forged and stale jobs', () => {
  const body = { run_id: 'r1', step: 'concept' };
  const ts = Math.floor(Date.now() / 1000);
  assert.throws(() => run(VERIFY_JS, { headers: { 'x-signature': 'sha256=00', 'x-timestamp': String(ts) }, body }), /Invalid signature/);
  const old = ts - 600;
  assert.throws(() => run(VERIFY_JS, { headers: { 'x-signature': appSign(JSON.stringify(body), old), 'x-timestamp': String(old) }, body }), /Invalid signature/);
});

test('the app accepts step calls signed by n8n', () => {
  const out = run(SIGN_JS, { run_id: 'r1', step: 'qa' }).json;
  assert.equal(out.body, JSON.stringify({ run_id: 'r1', step: 'qa' }));
  assert.equal(out.sig, appSign(out.body, out.ts));
  const cron = run(CRON_SIGN_JS, { job: 'optimise' }).json;
  assert.equal(cron.sig, appSign(cron.body, cron.ts));
});

test('next-step node carries the run id forward', () => {
  const $ = () => ({ item: { json: { run_id: 'r9' } } });
  assert.deepEqual(run(NEXT_JS, { done: false, next: 'clips', waitSeconds: 20 }, { $ }).json, { run_id: 'r9', step: 'clips', done: false, waitSeconds: 20 });
  assert.equal(run(NEXT_JS, { done: true }, { $ }).json.done, true);
});

test('scheduler triggers exactly the cron jobs the app serves', () => {
  const jobs = scheduler.nodes.filter((n) => n.type === 'n8n-nodes-base.set').map((n) => n.parameters.assignments.assignments[0].value);
  assert.deepEqual(jobs.sort(), ['monthly-reports', 'optimise', 'produce']);
  const route = readFileSync('src/app/api/internal/cron/[job]/route.ts', 'utf8');
  for (const j of jobs) assert.match(route, new RegExp(`'${j}'`));
});
