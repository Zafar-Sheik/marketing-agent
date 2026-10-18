export const OBJECTIVES = {
  awareness: { objective: 'REACH', optimizationGoal: 'REACH', billingEvent: 'CPM' },
  traffic: { objective: 'TRAFFIC', optimizationGoal: 'CLICK', billingEvent: 'CPC' },
  video_views: { objective: 'VIDEO_VIEWS', optimizationGoal: 'ENGAGED_VIEW', billingEvent: 'CPV' },
} as const;
export type Objective = keyof typeof OBJECTIVES;

export function objectiveFor(input: string): Objective {
  const s = input.toLowerCase();
  if (/(aware|reach|brand)/.test(s)) return 'awareness';
  if (/(view|watch|engage)/.test(s)) return 'video_views';
  return 'traffic'; // traffic, conversions, sales and anything else drive clicks to the landing page
}

export type AdReview = { adId: string; state: 'in_review' | 'approved' | 'rejected'; reason?: string };

export type AdDailyMetric = {
  adId: string;
  date: string;
  spendCents: number;
  impressions: number;
  reach: number;
  clicks: number;
  videoViews: number;
  avgWatchMs: number;
  conversions: number;
};

export interface TikTokAds {
  uploadVideo(url: string, fileName: string): Promise<string>;
  uploadImage(url: string, fileName: string): Promise<string>;
  createIdentity(displayName: string, avatarImageId: string): Promise<string>;
  createCampaign(input: { name: string; objective: Objective; budgetCents: number }): Promise<string>;
  createAdGroup(input: {
    campaignId: string;
    name: string;
    objective: Objective;
    dailyBudgetCents: number;
    startsAt: Date;
    endsAt: Date;
    targeting: Record<string, unknown>;
  }): Promise<string>;
  createAd(input: {
    adGroupId: string;
    name: string;
    identityId: string;
    videoId: string;
    thumbnailImageId: string;
    adText: string;
    callToAction: string;
    landingUrl: string;
  }): Promise<string>;
  reviewStatus(adIds: string[]): Promise<AdReview[]>;
  setCampaignStatus(campaignIds: string[], status: 'ENABLE' | 'DISABLE'): Promise<void>;
  setAdStatus(adIds: string[], status: 'ENABLE' | 'DISABLE'): Promise<void>;
  setAdGroupBudget(adGroupId: string, dailyBudgetCents: number): Promise<void>;
  report(startDate: string, endDate: string): Promise<AdDailyMetric[]>;
  interestCategories(): Promise<{ id: string; name: string }[]>;
}

export type PublishState = { state: 'processing' | 'published' | 'failed'; postId?: string; reason?: string };

export type PostStats = { postId: string; views: number; likes: number; comments: number; shares: number };

export interface TikTokPosting {
  creatorInfo(): Promise<{ privacyLevels: string[]; maxVideoSeconds: number; nickname: string }>;
  publishVideo(input: { videoUrl: string; caption: string; privacyLevel: string }): Promise<string>;
  publishPhotos(input: { imageUrls: string[]; title: string; caption: string; privacyLevel: string }): Promise<string>;
  status(publishId: string): Promise<PublishState>;
  stats(postIds: string[]): Promise<PostStats[]>;
}

export class TikTokError extends Error {
  constructor(
    public readonly code: number | string,
    message: string,
    public readonly authExpired = false,
  ) {
    super(`TikTok ${code}: ${message}`);
    this.name = 'TikTokError';
  }
}
