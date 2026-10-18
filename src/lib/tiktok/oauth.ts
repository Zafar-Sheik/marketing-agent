import { env, requireKey } from '@/env';
import { marketingApiBase } from './ads';
import { TikTokError } from './types';

export const POSTING_SCOPES = ['user.info.basic', 'video.publish', 'video.list'];

/** Ads Manager authorisation (advertiser grants the app access to ad accounts). */
export function adsAuthorizeUrl(state: string) {
  const u = new URL('https://business-api.tiktok.com/portal/auth');
  u.searchParams.set('app_id', requireKey('TIKTOK_ADS_APP_ID'));
  u.searchParams.set('state', state);
  u.searchParams.set('redirect_uri', `${env().TIKTOK_REDIRECT_URI}?kind=ads`);
  return u.toString();
}

export async function exchangeAdsCode(authCode: string) {
  const res = await fetch(`${marketingApiBase()}/oauth2/access_token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ app_id: requireKey('TIKTOK_ADS_APP_ID'), secret: requireKey('TIKTOK_ADS_APP_SECRET'), auth_code: authCode }),
  });
  const json = (await res.json()) as { code: number; message: string; data: { access_token: string; advertiser_ids: string[]; scope: number[] } };
  if (json.code !== 0) throw new TikTokError(json.code, json.message);
  return { accessToken: json.data.access_token, advertiserIds: json.data.advertiser_ids };
}

/** Login Kit authorisation for posting to the client's TikTok account. */
export function postingAuthorizeUrl(state: string) {
  const u = new URL('https://www.tiktok.com/v2/auth/authorize/');
  u.searchParams.set('client_key', requireKey('TIKTOK_CLIENT_KEY'));
  u.searchParams.set('scope', POSTING_SCOPES.join(','));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', `${env().TIKTOK_REDIRECT_URI}?kind=posting`);
  u.searchParams.set('state', state);
  return u.toString();
}

type TokenResponse = { access_token: string; refresh_token: string; expires_in: number; open_id: string; scope: string; error?: string; error_description?: string };

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: requireKey('TIKTOK_CLIENT_KEY'), client_secret: requireKey('TIKTOK_CLIENT_SECRET'), ...params }),
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || json.error) throw new TikTokError(json.error ?? res.status, json.error_description ?? 'token request failed', true);
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(Date.now() + json.expires_in * 1000),
    openId: json.open_id,
    scopes: json.scope.split(','),
  };
}

export function exchangePostingCode(code: string) {
  return tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: `${env().TIKTOK_REDIRECT_URI}?kind=posting` });
}

export function refreshPostingToken(refreshToken: string) {
  return tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' });
}
