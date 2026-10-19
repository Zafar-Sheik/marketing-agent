import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { resetEnv } from '@/env';
import { freshDb } from '@/test/db';
import { CHECKS, runChecks } from './checks';

const KEYS = ['ANTHROPIC_API_KEY', 'RUNWAY_API_KEY', 'ELEVENLABS_API_KEY', 'RESEND_API_KEY', 'EMAIL_FROM', 'N8N_API_KEY', 'DISPATCH_MODE', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

function setEnv(values: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetEnv();
}
const check = (id: string) => CHECKS.find((c) => c.id === id)!.run();

beforeAll(async () => {
  await freshDb();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setEnv(saved);
});

describe('setup check', () => {
  it('runs every check and never throws, even with nothing configured', async () => {
    setEnv({ AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '', ANTHROPIC_API_KEY: undefined, RUNWAY_API_KEY: undefined });
    const results = await runChecks();
    expect(results.map((r) => r.id)).toEqual(CHECKS.map((c) => c.id));
    expect(results.find((r) => r.id === 'anthropic')).toMatchObject({ status: 'skip' });
    expect(results.find((r) => r.id === 'database')).toMatchObject({ status: 'warn' }); // embedded DB in tests
    expect(results.find((r) => r.id === 'secrets')).toMatchObject({ status: 'fail' }); // test secrets are short
  });

  it('explains a rejected key and a missing voice in plain words', async () => {
    setEnv({ RUNWAY_API_KEY: 'bad', ELEVENLABS_API_KEY: 'good' });
    vi.stubGlobal('fetch', async (url: string) =>
      url.includes('runwayml') ? new Response('{}', { status: 401 }) : new Response('{}', { status: 404 }),
    );
    expect(await check('runway')).toMatchObject({ status: 'fail', fix: expect.stringMatching(/Copy the key again/) });
    expect(await check('elevenlabs')).toMatchObject({ status: 'fail', fix: expect.stringMatching(/Voice ID/) });
  });

  it('reports Runway credits and warns when low', async () => {
    setEnv({ RUNWAY_API_KEY: 'k' });
    vi.stubGlobal('fetch', async () => Response.json({ creditBalance: 40 }));
    expect(await check('runway')).toMatchObject({ status: 'ok', message: expect.stringMatching(/40 \(low/) });
  });

  it('catches the placeholder sender and unverified domains', async () => {
    setEnv({ RESEND_API_KEY: 'k', EMAIL_FROM: 'reports@example.com' });
    expect(await check('resend')).toMatchObject({ status: 'fail' });
    setEnv({ RESEND_API_KEY: 'k', EMAIL_FROM: 'reports@brand.test' });
    vi.stubGlobal('fetch', async () => Response.json({ data: [{ name: 'brand.test', status: 'pending' }] }));
    expect(await check('resend')).toMatchObject({ status: 'warn' });
    vi.stubGlobal('fetch', async () => Response.json({ name: 'restricted_api_key', message: 'This API key is restricted to only send emails' }, { status: 401 }));
    expect(await check('resend')).toMatchObject({ status: 'ok' });
  });

  it('checks that both n8n workflows are installed and active', async () => {
    setEnv({ DISPATCH_MODE: 'n8n', N8N_API_KEY: 'k' });
    vi.stubGlobal('fetch', async () => Response.json({ data: [{ name: 'Marketing Agent · agent runner', active: true }] }));
    expect(await check('n8n')).toMatchObject({ status: 'fail', fix: expect.stringMatching(/n8n:import/) });
    vi.stubGlobal('fetch', async () =>
      Response.json({ data: [{ name: 'Marketing Agent · agent runner', active: true }, { name: 'Marketing Agent · scheduler', active: true }] }),
    );
    expect(await check('n8n')).toMatchObject({ status: 'ok' });
    vi.stubGlobal('fetch', async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(await check('n8n')).toMatchObject({ status: 'fail', fix: expect.stringMatching(/localhost/) });
  });
});
