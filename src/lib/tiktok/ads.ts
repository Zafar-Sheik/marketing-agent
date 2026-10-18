import { env } from '@/env';
import { OBJECTIVES, TikTokError, type AdDailyMetric, type AdReview, type TikTokAds } from './types';

/** TikTok Marketing API v1.3 (Ads Manager). */
export function marketingApiBase() {
  return env().TIKTOK_SANDBOX ? 'https://sandbox-ads.tiktok.com/open_api/v1.3' : 'https://business-api.tiktok.com/open_api/v1.3';
}

// Codes TikTok uses for invalid / expired access tokens.
const AUTH_CODES = new Set([40001, 40100, 40102, 40104, 40105]);

type Envelope<T> = { code: number; message: string; request_id?: string; data: T };

export function liveAds(accessToken: string, advertiserId: string): TikTokAds {
  async function call<T>(method: 'GET' | 'POST', path: string, body: Record<string, unknown> = {}): Promise<T> {
    const payload = { advertiser_id: advertiserId, ...body };
    const url = new URL(`${marketingApiBase()}${path}`);
    if (method === 'GET') {
      for (const [k, v] of Object.entries(payload)) url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
    const res = await fetch(url, {
      method,
      headers: { 'Access-Token': accessToken, 'content-type': 'application/json' },
      body: method === 'POST' ? JSON.stringify(payload) : undefined,
    });
    const json = (await res.json().catch(() => ({ code: res.status, message: res.statusText }))) as Envelope<T>;
    if (json.code !== 0) throw new TikTokError(json.code, json.message, AUTH_CODES.has(json.code));
    return json.data;
  }
  const units = (cents: number) => Math.round(cents) / 100;
  const time = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
  const first = <T>(d: T | T[]) => (Array.isArray(d) ? d[0] : d);

  return {
    async uploadVideo(videoUrl, fileName) {
      const d = await call<{ video_id: string } | { video_id: string }[]>('POST', '/file/video/ad/upload/', {
        upload_type: 'UPLOAD_BY_URL',
        video_url: videoUrl,
        file_name: fileName,
      });
      return first(d).video_id;
    },
    async uploadImage(imageUrl, fileName) {
      const d = await call<{ image_id: string }>('POST', '/file/image/ad/upload/', {
        upload_type: 'UPLOAD_BY_URL',
        image_url: imageUrl,
        file_name: fileName,
      });
      return d.image_id;
    },
    async createIdentity(displayName, avatarImageId) {
      const d = await call<{ identity_id: string }>('POST', '/identity/create/', { display_name: displayName, image_uri: avatarImageId });
      return d.identity_id;
    },
    async createCampaign({ name, objective, budgetCents }) {
      const d = await call<{ campaign_id: string }>('POST', '/campaign/create/', {
        campaign_name: name,
        objective_type: OBJECTIVES[objective].objective,
        budget_mode: 'BUDGET_MODE_TOTAL',
        budget: units(budgetCents),
        operation_status: 'DISABLE', // never spends until we enable it after review + approval
      });
      return d.campaign_id;
    },
    async createAdGroup({ campaignId, name, objective, dailyBudgetCents, startsAt, endsAt, targeting }) {
      const o = OBJECTIVES[objective];
      const d = await call<{ adgroup_id: string }>('POST', '/adgroup/create/', {
        campaign_id: campaignId,
        adgroup_name: name,
        promotion_type: 'WEBSITE',
        placement_type: 'PLACEMENT_TYPE_NORMAL',
        placements: ['PLACEMENT_TIKTOK'],
        budget_mode: 'BUDGET_MODE_DAY',
        budget: units(dailyBudgetCents),
        schedule_type: 'SCHEDULE_START_END',
        schedule_start_time: time(startsAt),
        schedule_end_time: time(endsAt),
        optimization_goal: o.optimizationGoal,
        billing_event: o.billingEvent,
        bid_type: 'BID_TYPE_NO_BID',
        pacing: 'PACING_MODE_SMOOTH',
        // The campaign stays DISABLE until review passes, so nothing below it can spend.
        operation_status: 'ENABLE',
        ...targeting,
      });
      return d.adgroup_id;
    },
    async createAd(input) {
      const d = await call<{ ad_ids: string[] }>('POST', '/ad/create/', {
        adgroup_id: input.adGroupId,
        creatives: [
          {
            ad_name: input.name,
            ad_format: 'SINGLE_VIDEO',
            identity_type: 'CUSTOMIZED_USER',
            identity_id: input.identityId,
            video_id: input.videoId,
            image_ids: [input.thumbnailImageId],
            ad_text: input.adText.slice(0, 100),
            call_to_action: input.callToAction,
            landing_page_url: input.landingUrl,
          },
        ],
      });
      return d.ad_ids[0];
    },
    async reviewStatus(adIds) {
      const d = await call<{ list: { ad_id: string; secondary_status: string; reject_reasons?: string[] }[] }>('GET', '/ad/get/', {
        filtering: { ad_ids: adIds },
        fields: ['ad_id', 'secondary_status'],
      });
      return d.list.map((a): AdReview => {
        if (/REJECT|NOT_APPROVED/.test(a.secondary_status)) {
          return { adId: a.ad_id, state: 'rejected', reason: a.reject_reasons?.join('; ') || a.secondary_status };
        }
        if (/REVIEW/.test(a.secondary_status)) return { adId: a.ad_id, state: 'in_review' };
        return { adId: a.ad_id, state: 'approved' };
      });
    },
    async setCampaignStatus(campaignIds, status) {
      await call('POST', '/campaign/status/update/', { campaign_ids: campaignIds, operation_status: status });
    },
    async setAdStatus(adIds, status) {
      await call('POST', '/ad/status/update/', { ad_ids: adIds, operation_status: status });
    },
    async setAdGroupBudget(adGroupId, cents) {
      await call('POST', '/adgroup/budget/update/', { budget: [{ adgroup_id: adGroupId, budget: units(cents) }] });
    },
    async interestCategories() {
      const d = await call<{ interest_categories: { id: string; name: string }[] }>('GET', '/tool/interest_category/', {
        version: 2,
        placements: ['PLACEMENT_TIKTOK'],
      });
      return d.interest_categories.map((c) => ({ id: String(c.id), name: c.name }));
    },
    async report(startDate, endDate) {
      const rows: AdDailyMetric[] = [];
      for (let page = 1; ; page++) {
        const d = await call<{
          list: { dimensions: { ad_id: string; stat_time_day: string }; metrics: Record<string, string> }[];
          page_info: { total_page: number };
        }>('GET', '/report/integrated/get/', {
          report_type: 'BASIC',
          data_level: 'AUCTION_AD',
          dimensions: ['ad_id', 'stat_time_day'],
          metrics: ['spend', 'impressions', 'reach', 'clicks', 'video_play_actions', 'average_video_play', 'conversion'],
          start_date: startDate,
          end_date: endDate,
          page,
          page_size: 1000,
        });
        for (const r of d.list) {
          const m = (k: string) => Number(r.metrics[k] ?? 0);
          rows.push({
            adId: r.dimensions.ad_id,
            date: r.dimensions.stat_time_day.slice(0, 10),
            spendCents: Math.round(m('spend') * 100),
            impressions: m('impressions'),
            reach: m('reach'),
            clicks: m('clicks'),
            videoViews: m('video_play_actions'),
            avgWatchMs: Math.round(m('average_video_play') * 1000),
            conversions: m('conversion'),
          });
        }
        if (page >= d.page_info.total_page) return rows;
      }
    },
  };
}
