import type { TikTokAds, TikTokPosting, AdReview } from './types';

/** In-memory TikTok used with MOCK_PROVIDERS. Ads pass review on the second status check. */
export class MockTikTok {
  calls: { method: string; args: unknown }[] = [];
  campaigns = new Map<string, { status: 'ENABLE' | 'DISABLE'; budgetCents: number }>();
  adGroups = new Map<string, { dailyBudgetCents: number; targeting: Record<string, unknown> }>();
  adsState = new Map<string, { checks: number; status: 'ENABLE' | 'DISABLE'; reject?: string }>();
  publishes = new Map<string, number>();
  private seq = 1000;
  private id = (p: string) => `${p}${this.seq++}`;
  /** Set to make the next created ad fail TikTok review. */
  rejectNextAdWith?: string;

  ads(): TikTokAds {
    const log = (method: string, args: unknown) => this.calls.push({ method, args });
    return {
      uploadVideo: async (url, fileName) => (log('uploadVideo', { url, fileName }), this.id('v')),
      uploadImage: async (url, fileName) => (log('uploadImage', { url, fileName }), this.id('img')),
      createIdentity: async (displayName) => (log('createIdentity', { displayName }), this.id('ident')),
      createCampaign: async (input) => {
        log('createCampaign', input);
        const id = this.id('c');
        this.campaigns.set(id, { status: 'DISABLE', budgetCents: input.budgetCents });
        return id;
      },
      createAdGroup: async (input) => {
        log('createAdGroup', input);
        const id = this.id('g');
        this.adGroups.set(id, { dailyBudgetCents: input.dailyBudgetCents, targeting: input.targeting });
        return id;
      },
      createAd: async (input) => {
        log('createAd', input);
        const id = this.id('a');
        this.adsState.set(id, { checks: 0, status: 'DISABLE', reject: this.rejectNextAdWith });
        this.rejectNextAdWith = undefined;
        return id;
      },
      reviewStatus: async (adIds) =>
        adIds.map((adId): AdReview => {
          const ad = this.adsState.get(adId);
          if (!ad) return { adId, state: 'rejected', reason: 'unknown ad' };
          ad.checks++;
          if (ad.checks < 2) return { adId, state: 'in_review' };
          return ad.reject ? { adId, state: 'rejected', reason: ad.reject } : { adId, state: 'approved' };
        }),
      setCampaignStatus: async (ids, status) => {
        log('setCampaignStatus', { ids, status });
        ids.forEach((i) => this.campaigns.get(i) && (this.campaigns.get(i)!.status = status));
      },
      setAdStatus: async (ids, status) => {
        log('setAdStatus', { ids, status });
        ids.forEach((i) => this.adsState.get(i) && (this.adsState.get(i)!.status = status));
      },
      setAdGroupBudget: async (id, cents) => {
        log('setAdGroupBudget', { id, cents });
        const g = this.adGroups.get(id);
        if (g) g.dailyBudgetCents = cents;
      },
      interestCategories: async () => [
        { id: '14', name: 'Food & Drink' },
        { id: '22', name: 'Restaurants' },
        { id: '31', name: 'Fashion' },
        { id: '45', name: 'Fitness' },
        { id: '58', name: 'Travel' },
        { id: '61', name: 'Beauty & Personal Care' },
      ],
      report: async (startDate) =>
        [...this.adsState.keys()].map((adId, i) => ({
          adId,
          date: startDate,
          spendCents: 1500 + i * 700,
          impressions: 20_000 + i * 9_000,
          reach: 15_000 + i * 6_000,
          clicks: 300 + i * 250,
          videoViews: 12_000 + i * 5_000,
          avgWatchMs: 6_500,
          conversions: 4 + i * 3,
        })),
    };
  }

  posting(): TikTokPosting {
    return {
      creatorInfo: async () => ({ privacyLevels: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'], maxVideoSeconds: 600, nickname: 'mock_brand' }),
      publishVideo: async (input) => {
        this.calls.push({ method: 'publishVideo', args: input });
        const id = this.id('p');
        this.publishes.set(id, 0);
        return id;
      },
      publishPhotos: async (input) => {
        this.calls.push({ method: 'publishPhotos', args: input });
        const id = this.id('p');
        this.publishes.set(id, 0);
        return id;
      },
      status: async (publishId) => {
        const n = (this.publishes.get(publishId) ?? 0) + 1;
        this.publishes.set(publishId, n);
        return n < 2 ? { state: 'processing' } : { state: 'published', postId: `73${publishId.slice(1)}` };
      },
      stats: async (ids) => ids.map((postId, i) => ({ postId, views: 5_000 + i * 1_000, likes: 400, comments: 25, shares: 30 })),
    };
  }
}
