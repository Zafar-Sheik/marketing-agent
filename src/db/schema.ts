// Typed mirror of db/schema.sql (the SQL file is what runs against Neon).
// src/db/schema.test.ts fails if a table or column here drifts from the SQL.
import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  bigint,
  numeric,
  timestamp,
  date,
  char,
  jsonb,
  vector,
  primaryKey,
} from 'drizzle-orm/pg-core';

export const memberRole = pgEnum('member_role', ['owner', 'admin', 'editor', 'viewer']);
export const companyStatus = pgEnum('company_status', ['draft', 'training', 'active', 'paused', 'archived']);
export const assetKind = pgEnum('asset_kind', ['image', 'video', 'audio', 'document', 'font', 'logo', 'report']);
export const runStatus = pgEnum('run_status', ['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export const planStatus = pgEnum('plan_status', [
  'draft',
  'pending_approval',
  'changes_requested',
  'approved',
  'active',
  'completed',
]);
export const contentFormat = pgEnum('content_format', [
  'short_video',
  'image_post',
  'carousel',
  'spark_ad',
  'in_feed_ad',
  'logo',
]);
export const creativeStatus = pgEnum('creative_status', [
  'queued',
  'generating',
  'in_review',
  'changes_requested',
  'approved',
  'rejected',
  'scheduled',
  'published',
  'failed',
]);
export const requestStatus = pgEnum('request_status', ['submitted', 'planned', 'in_production', 'delivered', 'cancelled']);
export const adEntityStatus = pgEnum('ad_entity_status', [
  'draft',
  'pending_approval',
  'submitted',
  'in_review',
  'active',
  'paused',
  'rejected',
  'completed',
  'failed',
]);
export const postStatus = pgEnum('post_status', ['scheduled', 'publishing', 'published', 'failed', 'deleted']);
export const approvalDecision = pgEnum('approval_decision', ['pending', 'approved', 'rejected', 'changes_requested']);
export const connectionStatus = pgEnum('connection_status', ['connected', 'expired', 'revoked', 'error']);

const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => bigint(name, { mode: 'number' });
const textArray = (name: string) => text(name).array().notNull().default(sql`'{}'`);

// ---------------------------------------------------------------- identity
export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  name: text('name'),
  imageUrl: text('image_url'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workspaces = pgTable('workspaces', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  autopilot: boolean('autopilot').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: memberRole('role').notNull().default('editor'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

// ---------------------------------------------------------------- storage
export const assets = pgTable('assets', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull(),
  companyId: uuid('company_id'),
  kind: assetKind('kind').notNull(),
  s3Bucket: text('s3_bucket').notNull(),
  s3Key: text('s3_key').notNull(),
  mimeType: text('mime_type').notNull(),
  bytes: bigint('bytes', { mode: 'number' }).notNull(),
  sha256: text('sha256'),
  width: integer('width'),
  height: integer('height'),
  durationMs: integer('duration_ms'),
  uploadedBy: uuid('uploaded_by'),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- clients & brand
export const companies = pgTable('companies', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  industry: text('industry'),
  websiteUrl: text('website_url'),
  description: text('description'),
  headquartersCountry: char('headquarters_country', { length: 2 }),
  timezone: text('timezone').notNull().default('UTC'),
  currency: char('currency', { length: 3 }).notNull().default('USD'),
  monthlyAdBudgetCents: money('monthly_ad_budget_cents').notNull().default(0),
  status: companyStatus('status').notNull().default('draft'),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type FontSpec = { family: string; role: 'heading' | 'body' | 'accent'; assetId?: string };

export const brandProfiles = pgTable('brand_profiles', {
  id: id(),
  companyId: uuid('company_id').notNull(),
  version: integer('version').notNull(),
  isCurrent: boolean('is_current').notNull().default(false),
  primaryColors: textArray('primary_colors'),
  secondaryColors: textArray('secondary_colors'),
  fonts: jsonb('fonts').$type<FontSpec[]>().notNull().default([]),
  logoAssetId: uuid('logo_asset_id'),
  toneOfVoice: text('tone_of_voice'),
  brandValues: textArray('brand_values'),
  usp: text('usp'),
  targetAudience: text('target_audience'),
  competitors: textArray('competitors'),
  dos: textArray('dos'),
  donts: textArray('donts'),
  brandSummary: text('brand_summary'),
  createdAt: createdAt(),
});

export const portfolioItems = pgTable('portfolio_items', {
  id: id(),
  companyId: uuid('company_id').notNull(),
  assetId: uuid('asset_id').notNull(),
  title: text('title'),
  notes: text('notes'),
  aiDescription: text('ai_description'),
  createdAt: createdAt(),
});

export const trainingRuns = pgTable('training_runs', {
  id: id(),
  companyId: uuid('company_id').notNull(),
  brandProfileId: uuid('brand_profile_id'),
  status: runStatus('status').notNull().default('queued'),
  chunksIndexed: integer('chunks_indexed').notNull().default(0),
  error: text('error'),
  startedAt: ts('started_at'),
  finishedAt: ts('finished_at'),
  createdAt: createdAt(),
});

export const EMBEDDING_DIMENSIONS = 1536;

export const knowledgeChunks = pgTable('knowledge_chunks', {
  id: id(),
  companyId: uuid('company_id').notNull(),
  trainingRunId: uuid('training_run_id'),
  sourceAssetId: uuid('source_asset_id'),
  sourceType: text('source_type').notNull(),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

export const tiktokConnections = pgTable('tiktok_connections', {
  id: id(),
  companyId: uuid('company_id').notNull().unique(),
  advertiserId: text('advertiser_id'),
  businessOpenId: text('business_open_id'),
  accessTokenEnc: text('access_token_enc').notNull(),
  refreshTokenEnc: text('refresh_token_enc'),
  scopes: textArray('scopes'),
  expiresAt: ts('expires_at'),
  status: connectionStatus('status').notNull().default('connected'),
  connectedBy: uuid('connected_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------- monthly cycle
export type Kpi = { metric: string; target: number; unit?: string };

export const monthlyGoals = pgTable('monthly_goals', {
  id: id(),
  companyId: uuid('company_id').notNull(),
  month: date('month').notNull(),
  prompt: text('prompt').notNull(),
  kpis: jsonb('kpis').$type<Kpi[]>().notNull().default([]),
  adBudgetCents: money('ad_budget_cents').notNull(),
  locations: textArray('locations'),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
});

export type Source = { url: string; title: string };

export const researchReports = pgTable('research_reports', {
  id: id(),
  companyId: uuid('company_id').notNull(),
  monthlyGoalId: uuid('monthly_goal_id').notNull(),
  status: runStatus('status').notNull().default('queued'),
  executiveSummary: text('executive_summary'),
  trends: jsonb('trends').$type<unknown[]>().notNull().default([]),
  competitors: jsonb('competitors').$type<unknown[]>().notNull().default([]),
  audienceInsights: jsonb('audience_insights').$type<Record<string, unknown>>().notNull().default({}),
  sources: jsonb('sources').$type<Source[]>().notNull().default([]),
  pdfAssetId: uuid('pdf_asset_id'),
  createdAt: createdAt(),
});

export type ContentPillar = { name: string; description: string; share: number };

export const marketingPlans = pgTable('marketing_plans', {
  id: id(),
  companyId: uuid('company_id').notNull(),
  monthlyGoalId: uuid('monthly_goal_id').notNull(),
  researchReportId: uuid('research_report_id'),
  brandProfileId: uuid('brand_profile_id'),
  version: integer('version').notNull().default(1),
  status: planStatus('status').notNull().default('draft'),
  strategy: text('strategy'),
  contentPillars: jsonb('content_pillars').$type<ContentPillar[]>().notNull().default([]),
  budgetAllocation: jsonb('budget_allocation').$type<Record<string, number>>().notNull().default({}),
  feedback: text('feedback'),
  approvedBy: uuid('approved_by'),
  approvedAt: ts('approved_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const contentRequests = pgTable('content_requests', {
  id: id(),
  companyId: uuid('company_id').notNull(),
  marketingPlanId: uuid('marketing_plan_id'),
  weekStart: date('week_start').notNull(),
  format: contentFormat('format').notNull(),
  prompt: text('prompt').notNull(),
  isPaid: boolean('is_paid').notNull().default(false),
  status: requestStatus('status').notNull().default('submitted'),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
});

export const planItems = pgTable('plan_items', {
  id: id(),
  marketingPlanId: uuid('marketing_plan_id').notNull(),
  contentRequestId: uuid('content_request_id'),
  scheduledFor: ts('scheduled_for').notNull(),
  format: contentFormat('format').notNull(),
  pillar: text('pillar'),
  objective: text('objective').notNull(),
  brief: text('brief').notNull(),
  isPaid: boolean('is_paid').notNull().default(false),
  plannedSpendCents: money('planned_spend_cents').notNull().default(0),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- creative
export const logoRequests = pgTable('logo_requests', {
  id: id(),
  companyId: uuid('company_id').notNull(),
  prompt: text('prompt').notNull(),
  styles: textArray('styles'),
  conceptCount: integer('concept_count').notNull().default(4),
  status: requestStatus('status').notNull().default('submitted'),
  selectedCreativeId: uuid('selected_creative_id'),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
});

export type StoryboardScene = { scene: number; visual: string; voiceover: string; onScreenText?: string; durationMs: number };

export const creatives = pgTable('creatives', {
  id: id(),
  companyId: uuid('company_id').notNull(),
  planItemId: uuid('plan_item_id'),
  contentRequestId: uuid('content_request_id'),
  logoRequestId: uuid('logo_request_id'),
  parentCreativeId: uuid('parent_creative_id'),
  brandProfileId: uuid('brand_profile_id'),
  format: contentFormat('format').notNull(),
  status: creativeStatus('status').notNull().default('queued'),
  concept: text('concept'),
  hook: text('hook'),
  script: text('script'),
  storyboard: jsonb('storyboard').$type<StoryboardScene[]>().notNull().default([]),
  caption: text('caption'),
  hashtags: textArray('hashtags'),
  callToAction: text('call_to_action'),
  brandScore: numeric('brand_score', { precision: 4, scale: 3, mode: 'number' }),
  rationale: text('rationale'),
  feedback: text('feedback'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const creativeAssets = pgTable('creative_assets', {
  id: id(),
  creativeId: uuid('creative_id').notNull(),
  assetId: uuid('asset_id').notNull(),
  role: text('role').notNull(),
  provider: text('provider'),
  providerJobId: text('provider_job_id'),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- paid media
export const audienceSegments = pgTable('audience_segments', {
  id: id(),
  companyId: uuid('company_id').notNull(),
  researchReportId: uuid('research_report_id'),
  name: text('name').notNull(),
  ageGroups: textArray('age_groups'),
  genders: textArray('genders'),
  locationIds: textArray('location_ids'),
  languages: textArray('languages'),
  interestCategoryIds: textArray('interest_category_ids'),
  actionCategoryIds: textArray('action_category_ids'),
  hashtagIds: textArray('hashtag_ids'),
  rationale: text('rationale').notNull(),
  createdAt: createdAt(),
});

export const adCampaigns = pgTable('ad_campaigns', {
  id: id(),
  companyId: uuid('company_id').notNull(),
  marketingPlanId: uuid('marketing_plan_id'),
  tiktokCampaignId: text('tiktok_campaign_id').unique(),
  name: text('name').notNull(),
  objective: text('objective').notNull(),
  budgetCents: money('budget_cents').notNull(),
  status: adEntityStatus('status').notNull().default('draft'),
  startsAt: ts('starts_at'),
  endsAt: ts('ends_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const adGroups = pgTable('ad_groups', {
  id: id(),
  adCampaignId: uuid('ad_campaign_id').notNull(),
  audienceSegmentId: uuid('audience_segment_id'),
  tiktokAdgroupId: text('tiktok_adgroup_id').unique(),
  name: text('name').notNull(),
  optimizationGoal: text('optimization_goal').notNull(),
  bidStrategy: text('bid_strategy').notNull().default('LOWEST_COST'),
  dailyBudgetCents: money('daily_budget_cents').notNull(),
  targetingSnapshot: jsonb('targeting_snapshot').$type<Record<string, unknown>>().notNull(),
  status: adEntityStatus('status').notNull().default('draft'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const ads = pgTable('ads', {
  id: id(),
  adGroupId: uuid('ad_group_id').notNull(),
  creativeId: uuid('creative_id').notNull(),
  tiktokAdId: text('tiktok_ad_id').unique(),
  tiktokVideoId: text('tiktok_video_id'),
  adText: text('ad_text').notNull(),
  callToAction: text('call_to_action'),
  landingUrl: text('landing_url'),
  status: adEntityStatus('status').notNull().default('draft'),
  rejectionReason: text('rejection_reason'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const adMetricsDaily = pgTable(
  'ad_metrics_daily',
  {
    adId: uuid('ad_id').notNull(),
    date: date('date').notNull(),
    spendCents: money('spend_cents').notNull().default(0),
    impressions: money('impressions').notNull().default(0),
    reach: money('reach').notNull().default(0),
    clicks: money('clicks').notNull().default(0),
    videoViews: money('video_views').notNull().default(0),
    avgWatchMs: integer('avg_watch_ms').notNull().default(0),
    conversions: money('conversions').notNull().default(0),
    conversionValueCents: money('conversion_value_cents').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.adId, t.date] })],
);

// ---------------------------------------------------------------- organic
export const organicPosts = pgTable('organic_posts', {
  id: id(),
  companyId: uuid('company_id').notNull(),
  creativeId: uuid('creative_id').notNull(),
  scheduledFor: ts('scheduled_for').notNull(),
  privacyLevel: text('privacy_level').notNull().default('PUBLIC_TO_EVERYONE'),
  tiktokPublishId: text('tiktok_publish_id'),
  tiktokPostId: text('tiktok_post_id').unique(),
  shareUrl: text('share_url'),
  status: postStatus('status').notNull().default('scheduled'),
  error: text('error'),
  publishedAt: ts('published_at'),
  createdAt: createdAt(),
});

export const postMetricsDaily = pgTable(
  'post_metrics_daily',
  {
    organicPostId: uuid('organic_post_id').notNull(),
    date: date('date').notNull(),
    views: money('views').notNull().default(0),
    likes: money('likes').notNull().default(0),
    comments: money('comments').notNull().default(0),
    shares: money('shares').notNull().default(0),
    saves: money('saves').notNull().default(0),
    avgWatchMs: integer('avg_watch_ms').notNull().default(0),
    follows: money('follows').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.organicPostId, t.date] })],
);

// ---------------------------------------------------------------- governance
export type KpiResult = { metric: string; target: number; actual: number };

export const monthlyReports = pgTable('monthly_reports', {
  id: id(),
  companyId: uuid('company_id').notNull(),
  marketingPlanId: uuid('marketing_plan_id'),
  researchReportId: uuid('research_report_id'),
  month: date('month').notNull(),
  status: runStatus('status').notNull().default('queued'),
  summary: text('summary'),
  kpiResults: jsonb('kpi_results').$type<KpiResult[]>().notNull().default([]),
  creativeBreakdown: jsonb('creative_breakdown').$type<unknown[]>().notNull().default([]),
  logoBreakdown: jsonb('logo_breakdown').$type<unknown[]>().notNull().default([]),
  recommendations: text('recommendations'),
  pdfAssetId: uuid('pdf_asset_id'),
  sentAt: ts('sent_at'),
  createdAt: createdAt(),
});

export const APPROVAL_SUBJECTS = ['marketing_plan', 'creative', 'ad_campaign', 'logo_request'] as const;
export type ApprovalSubject = (typeof APPROVAL_SUBJECTS)[number];

export const approvals = pgTable('approvals', {
  id: id(),
  companyId: uuid('company_id').notNull(),
  subjectType: text('subject_type').$type<ApprovalSubject>().notNull(),
  subjectId: uuid('subject_id').notNull(),
  decision: approvalDecision('decision').notNull().default('pending'),
  comment: text('comment'),
  requestedAt: ts('requested_at').notNull().defaultNow(),
  decidedBy: uuid('decided_by'),
  decidedAt: ts('decided_at'),
});

export const agentRuns = pgTable('agent_runs', {
  id: id(),
  companyId: uuid('company_id'),
  workflow: text('workflow').notNull(),
  subjectType: text('subject_type'),
  subjectId: uuid('subject_id'),
  n8nExecutionId: text('n8n_execution_id'),
  status: runStatus('status').notNull().default('queued'),
  input: jsonb('input').$type<Record<string, unknown>>().notNull().default({}),
  output: jsonb('output').$type<Record<string, unknown>>(),
  error: text('error'),
  costCents: integer('cost_cents').notNull().default(0),
  idempotencyKey: text('idempotency_key').unique(),
  startedAt: ts('started_at'),
  finishedAt: ts('finished_at'),
  createdAt: createdAt(),
});
