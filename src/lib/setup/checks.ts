import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { sql } from 'drizzle-orm';
import { env } from '@/env';
import { db } from '@/db';

export type CheckResult = {
  id: string;
  name: string;
  status: 'ok' | 'warn' | 'fail' | 'skip';
  message: string;
  /** What to do about it, in plain words. */
  fix?: string;
  /** Section of docs/04-setup-guide.md. */
  guide: string;
};

type Check = { id: string; name: string; guide: string; run: () => Promise<Omit<CheckResult, 'id' | 'name' | 'guide'>> };

const missing = (key: string, guide: string) => ({
  status: 'skip' as const,
  message: `${key} is not set yet.`,
  fix: `Follow ${guide} of the setup guide, then paste the value into ${key}.`,
});

/** Turn a failed HTTP call into a plain-language result. */
async function httpCheck(res: Response, okMessage: (body: unknown) => string, keyName: string) {
  if (res.ok) return { status: 'ok' as const, message: okMessage(await res.json().catch(() => ({}))) };
  if (res.status === 401 || res.status === 403) {
    return { status: 'fail' as const, message: `The provider rejected ${keyName} (${res.status}).`, fix: `Copy the key again, check there are no spaces around it, and make sure billing/credits are set up.` };
  }
  return { status: 'warn' as const, message: `Could not confirm the key: the provider answered ${res.status}.`, fix: 'Try again in a minute; if it keeps happening, check the provider’s status page.' };
}

const timeout = () => AbortSignal.timeout(15_000);

export const CHECKS: Check[] = [
  {
    id: 'secrets',
    name: 'Generated secrets',
    guide: 'step 0',
    async run() {
      const e = env();
      const absent = (['AUTH_SECRET', 'ENCRYPTION_KEY', 'N8N_WEBHOOK_SECRET'] as const).filter((k) => !e[k] || e[k]!.length < 32);
      return absent.length
        ? { status: 'fail', message: `Missing or too short: ${absent.join(', ')}.`, fix: 'Run `npm run env:setup` on a fresh .env, or generate 64-character random values.' }
        : { status: 'ok', message: 'AUTH_SECRET, ENCRYPTION_KEY and N8N_WEBHOOK_SECRET are set.' };
    },
  },
  {
    id: 'app-url',
    name: 'App address',
    guide: 'step 0',
    async run() {
      const url = env().NEXT_PUBLIC_APP_URL;
      if (env().NODE_ENV === 'production' && !url.startsWith('https://')) {
        return { status: 'fail', message: `NEXT_PUBLIC_APP_URL is ${url}.`, fix: 'Set it to your public https address, e.g. https://agent.yourbrand.com. Google and TikTok sign-in need it.' };
      }
      return url.startsWith('https://')
        ? { status: 'ok', message: `${url}. Register ${url}/api/tiktok/callback/ads and /posting with TikTok.` }
        : { status: 'warn', message: `${url} is not https.`, fix: 'Fine for local testing. TikTok sign-in needs https: use a tunnel (cloudflared/ngrok) or your deployed URL.' };
    },
  },
  {
    id: 'database',
    name: 'Neon database',
    guide: 'step 1',
    async run() {
      const url = env().DATABASE_URL;
      const d = await db();
      const res = (await d.execute(sql`select to_regclass('public.companies') is not null as ready`)) as unknown as { rows: { ready: boolean }[] };
      if (!res.rows[0]?.ready) return { status: 'fail', message: 'Connected, but the tables are missing.', fix: 'Run `npm run db:migrate`.' };
      return url.startsWith('pglite:')
        ? { status: 'warn', message: 'Using the built-in local database.', fix: 'Fine for trying things out. For real use, create a Neon project and set DATABASE_URL (step 1).' }
        : { status: 'ok', message: 'Connected to Neon and the tables exist.' };
    },
  },
  {
    id: 's3',
    name: 'AWS S3 storage',
    guide: 'step 2',
    async run() {
      const e = env();
      if (!e.AWS_ACCESS_KEY_ID || !e.AWS_SECRET_ACCESS_KEY) return missing('AWS_ACCESS_KEY_ID', 'step 2');
      const s3 = new S3Client({ region: e.AWS_REGION, credentials: { accessKeyId: e.AWS_ACCESS_KEY_ID, secretAccessKey: e.AWS_SECRET_ACCESS_KEY } });
      const key = `setup-check/${Date.now()}.txt`;
      try {
        await s3.send(new PutObjectCommand({ Bucket: e.S3_BUCKET, Key: key, Body: 'ok' }), { abortSignal: timeout() });
        await s3.send(new DeleteObjectCommand({ Bucket: e.S3_BUCKET, Key: key }), { abortSignal: timeout() });
        return { status: 'ok', message: `Wrote and deleted a test file in ${e.S3_BUCKET} (${e.AWS_REGION}). Remember the CORS step so browser uploads work.` };
      } catch (err) {
        const name = (err as { name?: string }).name ?? 'Error';
        const fixes: Record<string, string> = {
          NoSuchBucket: `No bucket called "${e.S3_BUCKET}". Check S3_BUCKET matches the bucket name exactly.`,
          InvalidAccessKeyId: 'AWS_ACCESS_KEY_ID is wrong. Create a new access key on the IAM user.',
          SignatureDoesNotMatch: 'AWS_SECRET_ACCESS_KEY is wrong. Create a new access key and copy both values.',
          AccessDenied: 'The IAM user lacks permission. Attach infra/iam-policy.json with your bucket name.',
          PermanentRedirect: `The bucket is in a different region. Set AWS_REGION to the bucket's region.`,
          AuthorizationHeaderMalformed: `The bucket is in a different region. Set AWS_REGION to the bucket's region.`,
        };
        return { status: 'fail', message: `${name}: ${(err as Error).message}`, fix: fixes[name] ?? 'Check the bucket name, region and access key.' };
      }
    },
  },
  {
    id: 'google',
    name: 'Google sign-in',
    guide: 'step 3',
    async run() {
      const e = env();
      if (!e.AUTH_GOOGLE_ID || !e.AUTH_GOOGLE_SECRET) {
        return e.NODE_ENV === 'production'
          ? { status: 'fail', message: 'Not set. Nobody can sign in to the live app.', fix: 'Follow step 3.' }
          : { status: 'skip', message: 'Not set. Development uses email-only sign-in.', fix: 'Set it up before going live (step 3).' };
      }
      if (!e.AUTH_GOOGLE_ID.endsWith('.apps.googleusercontent.com')) {
        return { status: 'fail', message: 'AUTH_GOOGLE_ID doesn’t look like a Google client ID.', fix: 'It ends in .apps.googleusercontent.com. Copy the Client ID, not the project ID.' };
      }
      return { status: 'ok', message: `Configured. Redirect URI to register: ${e.NEXT_PUBLIC_APP_URL}/api/auth/callback/google` };
    },
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    guide: 'step 4',
    async run() {
      const key = env().ANTHROPIC_API_KEY;
      if (!key) return missing('ANTHROPIC_API_KEY', 'step 4');
      try {
        const page = await new Anthropic({ apiKey: key, timeout: 15_000, maxRetries: 0 }).models.list({ limit: 50 });
        const ids = page.data.map((m) => m.id);
        const wanted = [env().ANTHROPIC_MODEL, env().ANTHROPIC_FAST_MODEL];
        const unavailable = wanted.filter((m) => ids.length && !ids.includes(m));
        return unavailable.length
          ? { status: 'warn', message: `Key works, but ${unavailable.join(', ')} isn't listed for this account.`, fix: 'Check ANTHROPIC_MODEL / ANTHROPIC_FAST_MODEL.' }
          : { status: 'ok', message: `Key works. Models: ${wanted.join(', ')}.` };
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError) return { status: 'fail', message: 'The API key was rejected.', fix: 'Create a new key in the Claude Console › API keys and paste it again.' };
        if (err instanceof Anthropic.PermissionDeniedError) return { status: 'fail', message: 'The key has no access.', fix: 'Check billing and workspace permissions in the Claude Console.' };
        return { status: 'warn', message: `Couldn't reach Anthropic: ${(err as Error).message}` };
      }
    },
  },
  {
    id: 'openai',
    name: 'OpenAI (memory + images)',
    guide: 'step 5',
    async run() {
      const key = env().OPENAI_API_KEY;
      if (!key) return missing('OPENAI_API_KEY', 'step 5');
      try {
        await new OpenAI({ apiKey: key, timeout: 15_000, maxRetries: 0 }).models.retrieve(env().OPENAI_EMBEDDING_MODEL);
        return { status: 'ok', message: 'Key works. If image generation later says "organization must be verified", complete verification in OpenAI settings.' };
      } catch (err) {
        if (err instanceof OpenAI.AuthenticationError) return { status: 'fail', message: 'The API key was rejected.', fix: 'Create a new secret key and paste it again.' };
        return { status: 'warn', message: `Couldn't confirm: ${(err as Error).message}`, fix: 'Check billing credits on platform.openai.com.' };
      }
    },
  },
  {
    id: 'runway',
    name: 'Runway (video)',
    guide: 'step 6',
    async run() {
      const key = env().RUNWAY_API_KEY;
      if (!key) return missing('RUNWAY_API_KEY', 'step 6');
      const res = await fetch('https://api.dev.runwayml.com/v1/organization', {
        headers: { authorization: `Bearer ${key}`, 'X-Runway-Version': '2024-11-06' },
        signal: timeout(),
      });
      return httpCheck(res, (b) => {
        const credits = (b as { creditBalance?: number }).creditBalance;
        return credits === undefined ? 'Key works.' : `Key works. Credit balance: ${credits}${credits < 100 ? ' (low; top up before producing video)' : ''}.`;
      }, 'RUNWAY_API_KEY');
    },
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs (voice)',
    guide: 'step 7',
    async run() {
      const key = env().ELEVENLABS_API_KEY;
      if (!key) return missing('ELEVENLABS_API_KEY', 'step 7');
      const res = await fetch(`https://api.elevenlabs.io/v1/voices/${env().ELEVENLABS_DEFAULT_VOICE_ID}`, { headers: { 'xi-api-key': key }, signal: timeout() });
      if (res.status === 404 || res.status === 400) {
        return { status: 'fail', message: 'Key works, but the default voice was not found.', fix: 'Copy a Voice ID from ElevenLabs › Voices into ELEVENLABS_DEFAULT_VOICE_ID.' };
      }
      return httpCheck(res, (b) => `Key works. Default voice: ${(b as { name?: string }).name ?? 'found'}.`, 'ELEVENLABS_API_KEY');
    },
  },
  {
    id: 'creatomate',
    name: 'Creatomate (editing)',
    guide: 'step 8',
    async run() {
      const key = env().CREATOMATE_API_KEY;
      if (!key) return missing('CREATOMATE_API_KEY', 'step 8');
      const res = await fetch('https://api.creatomate.com/v1/templates', { headers: { authorization: `Bearer ${key}` }, signal: timeout() });
      return httpCheck(res, () => 'Key works.', 'CREATOMATE_API_KEY');
    },
  },
  {
    id: 'tavily',
    name: 'Tavily (research)',
    guide: 'step 9',
    async run() {
      const key = env().TAVILY_API_KEY;
      if (!key) return missing('TAVILY_API_KEY', 'step 9');
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'tiktok marketing trends', max_results: 1 }),
        signal: timeout(),
      });
      return httpCheck(res, () => 'Key works (used 1 search credit).', 'TAVILY_API_KEY');
    },
  },
  {
    id: 'resend',
    name: 'Resend (email)',
    guide: 'step 10',
    async run() {
      const key = env().RESEND_API_KEY;
      if (!key) return missing('RESEND_API_KEY', 'step 10');
      const from = env().EMAIL_FROM;
      const domain = from.split('@')[1] ?? '';
      if (domain === 'example.com') return { status: 'fail', message: 'EMAIL_FROM is still reports@example.com.', fix: 'Set it to an address on the domain you verified in Resend.' };
      const res = await fetch('https://api.resend.com/domains', { headers: { authorization: `Bearer ${key}` }, signal: timeout() });
      const body = (await res.json().catch(() => ({}))) as { data?: { name: string; status: string }[]; name?: string; message?: string };
      // Sending-only keys can't list domains; that still proves the key is valid.
      if (!res.ok && /restricted/i.test(`${body.name} ${body.message}`)) {
        return { status: 'ok', message: `Key works (sending-only). Make sure ${domain} shows Verified in Resend.` };
      }
      if (!res.ok) return { status: 'fail', message: `Resend rejected the key (${res.status}).`, fix: 'Create a new API key in Resend and paste it again.' };
      const match = body.data?.find((d) => d.name === domain);
      if (!match) return { status: 'fail', message: `${domain} is not added in Resend.`, fix: `Add ${domain} under Resend › Domains, or change EMAIL_FROM to a verified domain.` };
      return match.status === 'verified'
        ? { status: 'ok', message: `Key works and ${domain} is verified.` }
        : { status: 'warn', message: `${domain} is "${match.status}" in Resend.`, fix: 'Add the DNS records Resend shows and wait for Verified.' };
    },
  },
  {
    id: 'tiktok-ads',
    name: 'TikTok Ads Manager',
    guide: 'step 11',
    async run() {
      const e = env();
      if (!e.TIKTOK_ADS_APP_ID || !e.TIKTOK_ADS_APP_SECRET) return missing('TIKTOK_ADS_APP_ID', 'step 11');
      if (!/^\d+$/.test(e.TIKTOK_ADS_APP_ID)) return { status: 'fail', message: 'TIKTOK_ADS_APP_ID should be a number.', fix: 'Copy the App ID from business-api.tiktok.com › My Apps.' };
      return {
        status: 'ok',
        message: `Configured${e.TIKTOK_SANDBOX ? ' (sandbox)' : ''}. Verified for real when you connect a client.`,
        fix: `Advertiser redirect URL to register: ${e.NEXT_PUBLIC_APP_URL}/api/tiktok/callback/ads`,
      };
    },
  },
  {
    id: 'tiktok-posting',
    name: 'TikTok posting',
    guide: 'step 12',
    async run() {
      const e = env();
      if (!e.TIKTOK_CLIENT_KEY || !e.TIKTOK_CLIENT_SECRET) return missing('TIKTOK_CLIENT_KEY', 'step 12');
      return {
        status: 'ok',
        message: 'Configured. Verified for real when you connect a client’s TikTok account. Posts stay private until TikTok approves your app.',
        fix: `Login Kit redirect URI to register: ${e.NEXT_PUBLIC_APP_URL}/api/tiktok/callback/posting`,
      };
    },
  },
  {
    id: 'n8n',
    name: 'n8n',
    guide: 'step 13',
    async run() {
      const e = env();
      if (e.DISPATCH_MODE === 'inline') {
        return { status: 'warn', message: 'DISPATCH_MODE=inline: agents run inside the app (fine for testing, not for production).', fix: 'Set up n8n (step 13) and set DISPATCH_MODE=n8n.' };
      }
      if (!e.N8N_API_KEY) return missing('N8N_API_KEY', 'step 13b');
      let res: Response;
      try {
        res = await fetch(`${e.N8N_BASE_URL.replace(/\/$/, '')}/api/v1/workflows?limit=250`, { headers: { 'X-N8N-API-KEY': e.N8N_API_KEY }, signal: timeout() });
      } catch {
        return { status: 'fail', message: `Can't reach n8n at ${e.N8N_BASE_URL}.`, fix: 'Check N8N_BASE_URL. A deployed app can’t reach "localhost"; use n8n’s public address.' };
      }
      if (res.status === 401 || res.status === 403) return { status: 'fail', message: 'n8n rejected N8N_API_KEY.', fix: 'Create a new key in n8n › Settings › n8n API.' };
      if (!res.ok) return { status: 'fail', message: `n8n answered ${res.status}.` };
      const list = ((await res.json()) as { data?: { name: string; active?: boolean }[] }).data ?? [];
      const needed = ['Marketing Agent · agent runner', 'Marketing Agent · scheduler'];
      const absent = needed.filter((n) => !list.some((w) => w.name === n));
      if (absent.length) return { status: 'fail', message: `Not installed: ${absent.join(', ')}.`, fix: 'Run `npm run n8n:import`.' };
      const inactive = needed.filter((n) => list.some((w) => w.name === n && w.active === false));
      if (inactive.length) return { status: 'fail', message: `Installed but not active: ${inactive.join(', ')}.`, fix: 'Run `npm run n8n:import` again, or switch them on in n8n.' };
      return { status: 'ok', message: 'Both workflows are installed and active. To confirm n8n can reach the app, press Retrain on a client and watch n8n › Executions.' };
    },
  },
];

/** Run every check in parallel; one failing never stops the others. */
export async function runChecks(): Promise<CheckResult[]> {
  return Promise.all(
    CHECKS.map(async (c) => {
      try {
        return { id: c.id, name: c.name, guide: c.guide, ...(await c.run()) };
      } catch (err) {
        return { id: c.id, name: c.name, guide: c.guide, status: 'fail' as const, message: (err as Error).message, fix: `See ${c.guide} of the setup guide.` };
      }
    }),
  );
}
