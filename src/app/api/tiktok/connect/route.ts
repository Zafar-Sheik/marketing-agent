import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { randomBytes } from 'node:crypto';
import { route } from '@/lib/http';
import { requireCompany } from '@/lib/session';
import { adsAuthorizeUrl, postingAuthorizeUrl } from '@/lib/tiktok/oauth';

/** Start TikTok OAuth: ?company=<id>&kind=ads|posting */
export const GET = route(async (req: Request) => {
  const url = new URL(req.url);
  const kind = url.searchParams.get('kind') === 'posting' ? 'posting' : 'ads';
  const { company } = await requireCompany(url.searchParams.get('company') ?? '');
  const nonce = randomBytes(16).toString('hex');
  const state = `${company.id}.${nonce}`;
  (await cookies()).set('tiktok_oauth', state, { httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:', maxAge: 600, path: '/' });
  return NextResponse.redirect(kind === 'ads' ? adsAuthorizeUrl(state) : postingAuthorizeUrl(state));
});
