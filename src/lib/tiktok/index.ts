import { eq } from 'drizzle-orm';
import { env } from '@/env';
import { db, schema } from '@/db';
import { decrypt, encrypt } from '@/lib/crypto';
import { liveAds } from './ads';
import { livePosting } from './posting';
import { refreshPostingToken } from './oauth';
import { MockTikTok } from './mock';
import { TikTokError, type TikTokAds, type TikTokPosting } from './types';

export * from './types';

const g = globalThis as unknown as { __mockTikTok?: MockTikTok };
/** The shared in-memory TikTok used when MOCK_PROVIDERS=true (one per process). */
export function mockTikTok(reset = false) {
  if (reset || !g.__mockTikTok) g.__mockTikTok = new MockTikTok();
  return g.__mockTikTok;
}

export class NotConnectedError extends Error {
  constructor(what: 'ads' | 'posting') {
    super(
      what === 'ads'
        ? 'TikTok Ads Manager is not connected for this company.'
        : 'No TikTok account is connected for organic posting.',
    );
    this.name = 'NotConnectedError';
  }
}

async function connection(companyId: string) {
  const d = await db();
  const [c] = await d.select().from(schema.tiktokConnections).where(eq(schema.tiktokConnections.companyId, companyId));
  return c;
}

export async function adsFor(companyId: string): Promise<TikTokAds> {
  if (env().MOCK_PROVIDERS) return mockTikTok().ads();
  const c = await connection(companyId);
  if (!c?.adsAccessTokenEnc || !c.advertiserId || c.status !== 'connected') throw new NotConnectedError('ads');
  return guard(companyId, liveAds(decrypt(c.adsAccessTokenEnc), c.advertiserId));
}

export async function postingFor(companyId: string): Promise<TikTokPosting> {
  if (env().MOCK_PROVIDERS) return mockTikTok().posting();
  const c = await connection(companyId);
  if (!c?.postingAccessTokenEnc || c.status !== 'connected') throw new NotConnectedError('posting');
  let token = decrypt(c.postingAccessTokenEnc);
  if (c.postingExpiresAt && c.postingExpiresAt.getTime() < Date.now() + 5 * 60_000 && c.postingRefreshTokenEnc) {
    try {
      const fresh = await refreshPostingToken(decrypt(c.postingRefreshTokenEnc));
      token = fresh.accessToken;
      await (await db())
        .update(schema.tiktokConnections)
        .set({
          postingAccessTokenEnc: encrypt(fresh.accessToken),
          postingRefreshTokenEnc: encrypt(fresh.refreshToken),
          postingExpiresAt: fresh.expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(schema.tiktokConnections.id, c.id));
    } catch (e) {
      await markExpired(companyId);
      throw e;
    }
  }
  return guard(companyId, livePosting(token));
}

/** Any auth failure flips the connection to `expired` so the UI shows "Reconnect TikTok". */
function guard<T extends object>(companyId: string, api: T): T {
  return new Proxy(api, {
    get(target, prop) {
      const fn = target[prop as keyof T];
      if (typeof fn !== 'function') return fn;
      return async (...args: unknown[]) => {
        try {
          return await (fn as (...a: unknown[]) => unknown).apply(target, args);
        } catch (e) {
          if (e instanceof TikTokError && e.authExpired) await markExpired(companyId);
          throw e;
        }
      };
    },
  });
}

async function markExpired(companyId: string) {
  await (await db())
    .update(schema.tiktokConnections)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(eq(schema.tiktokConnections.companyId, companyId));
}
