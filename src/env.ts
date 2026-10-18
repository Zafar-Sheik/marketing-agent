import { z } from 'zod';

const PLACEHOLDER = 'replace-me';
const optionalKey = z
  .string()
  .optional()
  .transform((v) => (!v || v === PLACEHOLDER || v === '__GENERATE__' ? undefined : v));
const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : v === 'true' || v === '1'));
const num = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : Number(v)))
    .pipe(z.number().finite());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  AUTH_SECRET: optionalKey,
  ENCRYPTION_KEY: optionalKey,
  AUTH_GOOGLE_ID: optionalKey,
  AUTH_GOOGLE_SECRET: optionalKey,

  // `pglite:<dir>` runs an embedded Postgres so the app works before Neon is set up.
  DATABASE_URL: optionalKey.transform((v) => v ?? 'pglite:./.data/db'),
  DATABASE_URL_UNPOOLED: optionalKey,

  AWS_ACCESS_KEY_ID: optionalKey,
  AWS_SECRET_ACCESS_KEY: optionalKey,
  AWS_REGION: z.string().default('eu-west-1'),
  S3_BUCKET: z.string().default('marketing-agent-assets'),
  S3_PRESIGN_TTL_SECONDS: num(900),
  S3_MAX_UPLOAD_MB: num(500),

  N8N_BASE_URL: z.string().default('http://localhost:5678'),
  N8N_API_KEY: optionalKey,
  N8N_WEBHOOK_SECRET: optionalKey,
  APP_CALLBACK_URL: z.string().default('http://localhost:3000/api/n8n/callback'),
  // n8n: hand every job to n8n. inline: run the same steps inside Next.js (local dev, tests).
  DISPATCH_MODE: z.enum(['n8n', 'inline']).default('n8n'),

  ANTHROPIC_API_KEY: optionalKey,
  ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
  ANTHROPIC_FAST_MODEL: z.string().default('claude-haiku-5-5'),
  OPENAI_API_KEY: optionalKey,
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  OPENAI_IMAGE_MODEL: z.string().default('gpt-image-1'),
  RUNWAY_API_KEY: optionalKey,
  ELEVENLABS_API_KEY: optionalKey,
  ELEVENLABS_DEFAULT_VOICE_ID: z.string().default('21m00Tcm4TlvDq8ikWAM'),
  CREATOMATE_API_KEY: optionalKey,
  TAVILY_API_KEY: optionalKey,

  TIKTOK_ADS_APP_ID: optionalKey,
  TIKTOK_ADS_APP_SECRET: optionalKey,
  TIKTOK_CLIENT_KEY: optionalKey,
  TIKTOK_CLIENT_SECRET: optionalKey,
  TIKTOK_REDIRECT_URI: z.string().default('http://localhost:3000/api/tiktok/callback'),
  TIKTOK_SANDBOX: bool(true),

  RESEND_API_KEY: optionalKey,
  EMAIL_FROM: z.string().default('reports@example.com'),

  // Replace every external provider with deterministic fakes. Never spends money.
  MOCK_PROVIDERS: bool(false),

  BRAND_SCORE_THRESHOLD: num(0.8),
  MAX_DAILY_BUDGET_CHANGE_PCT: num(30),
  PRODUCTION_LEAD_DAYS: num(7),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;
export function env(): Env {
  cached ??= schema.parse(process.env);
  return cached;
}

/** Test hook: re-read process.env on next access. */
export function resetEnv() {
  cached = undefined;
}

type KeyName = { [K in keyof Env]: Env[K] extends string | undefined ? K : never }[keyof Env];

/** Read a key that a feature cannot work without, with an actionable error. */
export function requireKey(name: KeyName): string {
  const value = env()[name];
  if (!value) {
    throw new MissingKeyError(name);
  }
  return value as string;
}

export class MissingKeyError extends Error {
  constructor(public readonly key: string) {
    super(`${key} is not set. Add it to .env (run \`npm run env:check\` to see everything still missing).`);
    this.name = 'MissingKeyError';
  }
}
