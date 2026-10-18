import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { parseEnv, fillSecrets, missingKeys, PLACEHOLDER, GENERATE } from './env.mjs';

const root = new URL('..', import.meta.url).pathname;
const exampleText = readFileSync(join(root, '.env.example'), 'utf8');
const example = parseEnv(exampleText);
const script = join(root, 'scripts/env.mjs');

test('.env.example has no duplicate keys', () => {
  const keys = exampleText.split('\n').filter((l) => /^[A-Z]/.test(l)).map((l) => l.split('=')[0]);
  assert.equal(new Set(keys).size, keys.length);
});

test('only API keys, account ids and connection strings are left for the user', () => {
  const userFilled = [...example].filter(([, v]) => v === PLACEHOLDER).map(([k]) => k);
  for (const key of userFilled) {
    assert.match(key, /(_API_KEY|_SECRET|_SECRET_ACCESS_KEY|_ID|DATABASE_URL.*|_CLIENT_KEY)$/, `${key} should have a default`);
  }
});

test('every service the docs rely on is configured', () => {
  for (const key of [
    'DATABASE_URL', 'AWS_ACCESS_KEY_ID', 'S3_BUCKET', 'N8N_BASE_URL', 'N8N_WEBHOOK_SECRET',
    'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'RUNWAY_API_KEY', 'ELEVENLABS_API_KEY', 'CREATOMATE_API_KEY',
    'TAVILY_API_KEY', 'TIKTOK_ADS_APP_ID', 'TIKTOK_CLIENT_KEY', 'RESEND_API_KEY', 'ENCRYPTION_KEY',
  ]) {
    assert.ok(example.has(key), `${key} missing from .env.example`);
  }
});

test('setup generates distinct 32-byte secrets and leaves API keys for the user', () => {
  const filled = parseEnv(fillSecrets(exampleText));
  const generated = [...example].filter(([, v]) => v === GENERATE).map(([k]) => filled.get(k));
  assert.ok(generated.length >= 3);
  for (const secret of generated) assert.match(secret, /^[0-9a-f]{64}$/);
  assert.equal(new Set(generated).size, generated.length);
  assert.deepEqual(
    missingKeys(exampleText, fillSecrets(exampleText)),
    [...example].filter(([, v]) => v === PLACEHOLDER).map(([k]) => k),
  );
});

test('CLI: setup then check reports missing keys, then passes once keys are pasted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'env-'));
  try {
    writeFileSync(join(dir, '.env.example'), exampleText);
    execFileSync('node', [script, 'setup', dir]);
    const first = spawnSync('node', [script, 'check', dir], { encoding: 'utf8' });
    assert.equal(first.status, 1);
    assert.match(first.stderr, /ANTHROPIC_API_KEY/);

    const envPath = join(dir, '.env');
    writeFileSync(envPath, readFileSync(envPath, 'utf8').replaceAll(`=${PLACEHOLDER}`, '=sk-test-123'));
    const second = spawnSync('node', [script, 'check', dir], { encoding: 'utf8' });
    assert.equal(second.status, 0, second.stderr);

    // Running setup again must never overwrite real keys.
    execFileSync('node', [script, 'setup', dir]);
    assert.match(readFileSync(envPath, 'utf8'), /ANTHROPIC_API_KEY=sk-test-123/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
