// Generates the n8n workflow files in n8n/ (run: node scripts/build-n8n.mjs).
// Kept as code so the signing logic is shared with tests and can't drift.
import { mkdirSync, writeFileSync } from 'node:fs';

export const SIGN_JS = `const crypto = require('crypto');
const body = JSON.stringify({ run_id: $json.run_id, step: $json.step });
const ts = Math.floor(Date.now() / 1000);
const sig = 'sha256=' + crypto.createHmac('sha256', $env.N8N_WEBHOOK_SECRET).update(ts + '.' + body).digest('hex');
return { json: { run_id: $json.run_id, step: $json.step, body, sig, ts: String(ts) } };`;

export const VERIFY_JS = `const crypto = require('crypto');
const h = $json.headers;
const body = JSON.stringify($json.body);
const expected = 'sha256=' + crypto.createHmac('sha256', $env.N8N_WEBHOOK_SECRET).update(h['x-timestamp'] + '.' + body).digest('hex');
if (h['x-signature'] !== expected || Math.abs(Date.now() / 1000 - Number(h['x-timestamp'])) > 300) {
  throw new Error('Invalid signature');
}
return { json: { run_id: $json.body.run_id, step: $json.body.step } };`;

export const NEXT_JS = `const sent = $('Sign request').item.json;
return { json: { run_id: sent.run_id, step: $json.next, done: $json.done === true, waitSeconds: Number($json.waitSeconds || 0) } };`;

export const CRON_SIGN_JS = `const crypto = require('crypto');
const body = JSON.stringify({ job: $json.job });
const ts = Math.floor(Date.now() / 1000);
const sig = 'sha256=' + crypto.createHmac('sha256', $env.N8N_WEBHOOK_SECRET).update(ts + '.' + body).digest('hex');
return { json: { job: $json.job, body, sig, ts: String(ts) } };`;

const node = (name, type, typeVersion, position, parameters, extra = {}) => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  name,
  type,
  typeVersion,
  position,
  parameters,
  ...extra,
});
const to = (...names) => ({ main: names.map((n) => (n ? [{ node: n, type: 'main', index: 0 }] : [])) });

const signedPost = (name, position, path) =>
  node(
    name,
    'n8n-nodes-base.httpRequest',
    4.2,
    position,
    {
      method: 'POST',
      url: `={{ $env.APP_INTERNAL_URL }}${path}`,
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'X-Signature', value: '={{ $json.sig }}' },
          { name: 'X-Timestamp', value: '={{ $json.ts }}' },
        ],
      },
      sendBody: true,
      contentType: 'raw',
      rawContentType: 'application/json',
      body: '={{ $json.body }}',
      options: { timeout: 900000 },
    },
    { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 },
  );

export const agentRunner = {
  name: 'Marketing Agent · agent runner',
  nodes: [
    node('Job received', 'n8n-nodes-base.webhook', 2, [0, 300], { httpMethod: 'POST', path: 'agent-runner', responseMode: 'onReceived', responseCode: 202, options: {} }, { webhookId: 'agent-runner' }),
    node('Verify signature', 'n8n-nodes-base.code', 2, [220, 300], { mode: 'runOnceForEachItem', jsCode: VERIFY_JS }),
    node('Sign request', 'n8n-nodes-base.code', 2, [440, 300], { mode: 'runOnceForEachItem', jsCode: SIGN_JS }),
    signedPost('Run step', [660, 300], '/api/internal/steps'),
    node('Next step', 'n8n-nodes-base.code', 2, [880, 300], { mode: 'runOnceForEachItem', jsCode: NEXT_JS }),
    node('Finished?', 'n8n-nodes-base.if', 2, [1100, 300], {
      conditions: {
        options: { caseSensitive: true, typeValidation: 'loose' },
        combinator: 'and',
        conditions: [{ id: 'done', leftValue: '={{ $json.done }}', rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }],
      },
      options: {},
    }),
    node('Done', 'n8n-nodes-base.noOp', 1, [1320, 200], {}),
    node('Needs a wait?', 'n8n-nodes-base.if', 2, [1320, 420], {
      conditions: {
        options: { caseSensitive: true, typeValidation: 'loose' },
        combinator: 'and',
        conditions: [{ id: 'wait', leftValue: '={{ $json.waitSeconds }}', rightValue: 0, operator: { type: 'number', operation: 'gt' } }],
      },
      options: {},
    }),
    // Durable: waits longer than ~65s are persisted in n8n's database and survive restarts.
    node('Wait', 'n8n-nodes-base.wait', 1.1, [1540, 520], { resume: 'timeInterval', amount: '={{ $json.waitSeconds }}', unit: 'seconds' }, { webhookId: 'agent-runner-wait' }),
  ],
  connections: {
    'Job received': to('Verify signature'),
    'Verify signature': to('Sign request'),
    'Sign request': to('Run step'),
    'Run step': to('Next step'),
    'Next step': to('Finished?'),
    'Finished?': to('Done', 'Needs a wait?'),
    'Needs a wait?': to('Wait', 'Sign request'),
    Wait: to('Sign request'),
  },
  settings: { executionOrder: 'v1', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'all' },
  active: false,
};

const schedule = (name, position, rule) => node(name, 'n8n-nodes-base.scheduleTrigger', 1.2, position, { rule: { interval: [rule] } });
const setJob = (name, position, job) =>
  node(name, 'n8n-nodes-base.set', 3.4, position, {
    assignments: { assignments: [{ id: 'job', name: 'job', value: job, type: 'string' }] },
    options: {},
  });

export const scheduler = {
  name: 'Marketing Agent · scheduler',
  nodes: [
    schedule('Every hour', [0, 100], { field: 'hours', hoursInterval: 1 }),
    setJob('Produce due content', [220, 100], 'produce'),
    schedule('Daily 06:00', [0, 300], { field: 'days', daysInterval: 1, triggerAtHour: 6 }),
    setJob('Optimise ads', [220, 300], 'optimise'),
    schedule('Daily 07:00', [0, 500], { field: 'days', daysInterval: 1, triggerAtHour: 7 }),
    setJob('Monthly reports', [220, 500], 'monthly-reports'),
    node('Sign job', 'n8n-nodes-base.code', 2, [440, 300], { mode: 'runOnceForEachItem', jsCode: CRON_SIGN_JS }),
    signedPost('Run job', [660, 300], "/api/internal/cron/{{ $json.job }}"),
  ],
  connections: {
    'Every hour': to('Produce due content'),
    'Produce due content': to('Sign job'),
    'Daily 06:00': to('Optimise ads'),
    'Optimise ads': to('Sign job'),
    'Daily 07:00': to('Monthly reports'),
    'Monthly reports': to('Sign job'),
    'Sign job': to('Run job'),
  },
  settings: { executionOrder: 'v1' },
  active: false,
};

/**
 * n8n Cloud doesn't let you set environment variables, so the Cloud copies read the same two
 * settings from n8n Variables ($vars) instead of $env.
 */
export const forCloud = (wf) => JSON.parse(JSON.stringify(wf).replaceAll('$env.', '$vars.'));

if (process.argv[1]?.endsWith('build-n8n.mjs')) {
  mkdirSync('n8n/cloud', { recursive: true });
  for (const [file, wf] of [['agent-runner', agentRunner], ['scheduler', scheduler]]) {
    writeFileSync(`n8n/${file}.json`, JSON.stringify(wf, null, 2) + '\n');
    writeFileSync(`n8n/cloud/${file}.json`, JSON.stringify(forCloud(wf), null, 2) + '\n');
  }
  console.log('Wrote n8n/*.json (self-hosted) and n8n/cloud/*.json (n8n Cloud)');
}
