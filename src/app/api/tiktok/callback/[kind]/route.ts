import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { schema } from '@/db';
import { env } from '@/env';
import { encrypt } from '@/lib/crypto';
import { route } from '@/lib/http';
import { HttpError, requireCompany } from '@/lib/session';
import { exchangeAdsCode, exchangePostingCode } from '@/lib/tiktok/oauth';

/** TikTok redirects here after consent: /api/tiktok/callback/ads (Ads Manager) or /posting (Login Kit). */
export const GET = route(async (req: Request, { params }: { params: Promise<{ kind: string }> }) => {
  const url = new URL(req.url);
  const { kind: raw } = await params;
  if (raw !== 'ads' && raw !== 'posting') throw new HttpError(404, 'Unknown callback');
  const kind = raw;
  const state = url.searchParams.get('state') ?? '';
  const jar = await cookies();
  if (!state || jar.get('tiktok_oauth')?.value !== state) throw new HttpError(400, 'OAuth state mismatch. Start the connection again.');
  jar.delete('tiktok_oauth');
  const { company, user, db } = await requireCompany(state.split('.')[0]);
  const code = url.searchParams.get(kind === 'ads' ? 'auth_code' : 'code') ?? url.searchParams.get('code');
  if (!code) throw new HttpError(400, url.searchParams.get('error_description') ?? 'TikTok did not return an authorisation code.');

  const values =
    kind === 'ads'
      ? await exchangeAdsCode(code).then((t) => ({
          advertiserId: t.advertiserIds[0],
          adsAccessTokenEnc: encrypt(t.accessToken),
        }))
      : await exchangePostingCode(code).then((t) => ({
          businessOpenId: t.openId,
          postingAccessTokenEnc: encrypt(t.accessToken),
          postingRefreshTokenEnc: encrypt(t.refreshToken),
          postingExpiresAt: t.expiresAt,
          scopes: t.scopes,
        }));
  await db
    .insert(schema.tiktokConnections)
    .values({ companyId: company.id, connectedBy: user.id, status: 'connected', ...values })
    .onConflictDoUpdate({ target: schema.tiktokConnections.companyId, set: { ...values, status: 'connected', updatedAt: new Date() } });
  return NextResponse.redirect(`${env().NEXT_PUBLIC_APP_URL}/companies/${company.slug}/settings?connected=${kind}`);
});
