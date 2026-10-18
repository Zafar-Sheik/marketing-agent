-- =============================================================================
-- Marketing Agent — NeonDB (PostgreSQL 16+) schema
-- Source of truth for docs/03-erd.md. `npm run test:schema` loads this file
-- into an in-memory Postgres (PGlite + pgvector) and verifies it end to end.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;     -- pgvector: brand knowledge embeddings (gen_random_uuid() is core in PG13+)

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
CREATE TYPE member_role        AS ENUM ('owner', 'admin', 'editor', 'viewer');
CREATE TYPE company_status     AS ENUM ('draft', 'training', 'active', 'paused', 'archived');
CREATE TYPE asset_kind         AS ENUM ('image', 'video', 'audio', 'document', 'font', 'logo', 'report');
CREATE TYPE run_status         AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');
CREATE TYPE plan_status        AS ENUM ('draft', 'pending_approval', 'changes_requested', 'approved', 'active', 'completed');
CREATE TYPE content_format     AS ENUM ('short_video', 'image_post', 'carousel', 'spark_ad', 'in_feed_ad', 'logo');
CREATE TYPE creative_status    AS ENUM ('queued', 'generating', 'in_review', 'changes_requested', 'approved', 'rejected', 'scheduled', 'published', 'failed');
CREATE TYPE request_status     AS ENUM ('submitted', 'planned', 'in_production', 'delivered', 'cancelled');
CREATE TYPE ad_entity_status   AS ENUM ('draft', 'pending_approval', 'submitted', 'in_review', 'active', 'paused', 'rejected', 'completed', 'failed');
CREATE TYPE post_status        AS ENUM ('scheduled', 'publishing', 'published', 'failed', 'deleted');
CREATE TYPE approval_decision  AS ENUM ('pending', 'approved', 'rejected', 'changes_requested');
CREATE TYPE connection_status  AS ENUM ('connected', 'expired', 'revoked', 'error');

-- Shared trigger to keep updated_at honest.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Identity & tenancy
-- -----------------------------------------------------------------------------
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL UNIQUE,
  name           text,
  image_url      text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  slug           text NOT NULL UNIQUE,
  -- When false every plan, creative and ad needs a human approval before it
  -- spends money or goes public.
  autopilot      boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspace_members (
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role           member_role NOT NULL DEFAULT 'editor',
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

-- -----------------------------------------------------------------------------
-- Files in AWS S3 (every binary the system touches is registered here)
-- -----------------------------------------------------------------------------
CREATE TABLE assets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  company_id     uuid,                       -- FK added after companies exists
  kind           asset_kind NOT NULL,
  s3_bucket      text NOT NULL,
  s3_key         text NOT NULL,
  mime_type      text NOT NULL,
  bytes          bigint NOT NULL CHECK (bytes >= 0),
  sha256         text,
  width          integer,
  height         integer,
  duration_ms    integer,
  uploaded_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (s3_bucket, s3_key)
);

-- -----------------------------------------------------------------------------
-- Clients (companies) and their brand
-- -----------------------------------------------------------------------------
CREATE TABLE companies (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id               uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name                       text NOT NULL,
  slug                       text NOT NULL,
  industry                   text,
  website_url                text,
  description                text,
  headquarters_country       char(2),
  timezone                   text NOT NULL DEFAULT 'UTC',
  currency                   char(3) NOT NULL DEFAULT 'USD',
  monthly_ad_budget_cents    bigint NOT NULL DEFAULT 0 CHECK (monthly_ad_budget_cents >= 0),
  status                     company_status NOT NULL DEFAULT 'draft',
  created_by                 uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug)
);

ALTER TABLE assets
  ADD CONSTRAINT assets_company_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

-- Versioned: every retrain creates a new row; exactly one is current.
CREATE TABLE brand_profiles (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  version            integer NOT NULL CHECK (version > 0),
  is_current         boolean NOT NULL DEFAULT false,
  primary_colors     text[] NOT NULL DEFAULT '{}',   -- hex, e.g. {'#0F172A'}
  secondary_colors   text[] NOT NULL DEFAULT '{}',
  fonts              jsonb  NOT NULL DEFAULT '[]',   -- [{family, role, asset_id}]
  logo_asset_id      uuid REFERENCES assets(id) ON DELETE SET NULL,
  tone_of_voice      text,
  brand_values       text[] NOT NULL DEFAULT '{}',
  usp                text,
  target_audience    text,
  competitors        text[] NOT NULL DEFAULT '{}',
  dos                text[] NOT NULL DEFAULT '{}',
  donts              text[] NOT NULL DEFAULT '{}',
  brand_summary      text,                          -- AI-distilled "brand bible"
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, version),
  CONSTRAINT brand_colors_hex CHECK (
    array_to_string(primary_colors || secondary_colors, ',') ~ '^(#[0-9A-Fa-f]{6}(,#[0-9A-Fa-f]{6})*)?$'
  )
);
CREATE UNIQUE INDEX brand_profiles_one_current ON brand_profiles (company_id) WHERE is_current;

CREATE TABLE portfolio_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  asset_id       uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  title          text,
  notes          text,
  ai_description text,      -- vision-model caption, feeds training
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE training_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  brand_profile_id   uuid REFERENCES brand_profiles(id) ON DELETE SET NULL,
  status             run_status NOT NULL DEFAULT 'queued',
  chunks_indexed     integer NOT NULL DEFAULT 0,
  error              text,
  started_at         timestamptz,
  finished_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- RAG memory: "training" = embedding the client's material for retrieval.
CREATE TABLE knowledge_chunks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  training_run_id    uuid REFERENCES training_runs(id) ON DELETE SET NULL,
  source_asset_id    uuid REFERENCES assets(id) ON DELETE CASCADE,
  source_type        text NOT NULL,          -- 'portfolio' | 'website' | 'brief' | 'report'
  content            text NOT NULL,
  embedding          vector(1536) NOT NULL,
  metadata           jsonb NOT NULL DEFAULT '{}',
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_chunks_company_idx ON knowledge_chunks (company_id);
CREATE INDEX knowledge_chunks_embedding_idx ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);

CREATE TABLE tiktok_connections (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                 uuid NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  -- TikTok Ads Manager (Marketing API). Long-lived token, AES-256-GCM with ENCRYPTION_KEY.
  advertiser_id              text,
  ads_access_token_enc       text,
  -- TikTok account used for organic posts (Content Posting API). Expires; refreshed.
  business_open_id           text,
  posting_access_token_enc   text,
  posting_refresh_token_enc  text,
  posting_expires_at         timestamptz,
  scopes                     text[] NOT NULL DEFAULT '{}',
  status                     connection_status NOT NULL DEFAULT 'connected',
  connected_by               uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CHECK (ads_access_token_enc IS NOT NULL OR posting_access_token_enc IS NOT NULL)
);

-- -----------------------------------------------------------------------------
-- Monthly cycle: goals -> research -> plan -> calendar
-- -----------------------------------------------------------------------------
CREATE TABLE monthly_goals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  month              date NOT NULL CHECK (extract(day FROM month) = 1),
  prompt             text NOT NULL,            -- the user's own words
  kpis               jsonb NOT NULL DEFAULT '[]',  -- [{metric, target}]
  ad_budget_cents    bigint NOT NULL CHECK (ad_budget_cents >= 0),
  locations          text[] NOT NULL DEFAULT '{}', -- ISO country / region codes
  created_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, month)
);

CREATE TABLE research_reports (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  monthly_goal_id    uuid NOT NULL REFERENCES monthly_goals(id) ON DELETE CASCADE,
  status             run_status NOT NULL DEFAULT 'queued',
  executive_summary  text,
  trends             jsonb NOT NULL DEFAULT '[]',   -- sounds, hashtags, formats
  competitors        jsonb NOT NULL DEFAULT '[]',
  audience_insights  jsonb NOT NULL DEFAULT '{}',
  sources            jsonb NOT NULL DEFAULT '[]',   -- [{url, title, retrieved_at}]
  pdf_asset_id       uuid REFERENCES assets(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE marketing_plans (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  monthly_goal_id    uuid NOT NULL REFERENCES monthly_goals(id) ON DELETE CASCADE,
  research_report_id uuid REFERENCES research_reports(id) ON DELETE SET NULL,
  brand_profile_id   uuid REFERENCES brand_profiles(id) ON DELETE SET NULL,
  version            integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status             plan_status NOT NULL DEFAULT 'draft',
  strategy           text,
  content_pillars    jsonb NOT NULL DEFAULT '[]',
  budget_allocation  jsonb NOT NULL DEFAULT '{}',  -- {awareness: 0.4, traffic: 0.35, ...}
  feedback           text,                         -- user's change request
  approved_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (monthly_goal_id, version)
);

-- User-prompted weekly asks ("make a 20s video about our Black Friday deal").
CREATE TABLE content_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  marketing_plan_id  uuid REFERENCES marketing_plans(id) ON DELETE SET NULL,
  week_start         date NOT NULL CHECK (extract(isodow FROM week_start) = 1),
  format             content_format NOT NULL,
  prompt             text NOT NULL,
  is_paid            boolean NOT NULL DEFAULT false,
  status             request_status NOT NULL DEFAULT 'submitted',
  created_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- One row per calendar slot in the plan.
CREATE TABLE plan_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marketing_plan_id  uuid NOT NULL REFERENCES marketing_plans(id) ON DELETE CASCADE,
  content_request_id uuid REFERENCES content_requests(id) ON DELETE SET NULL,
  scheduled_for      timestamptz NOT NULL,
  format             content_format NOT NULL,
  pillar             text,
  objective          text NOT NULL,               -- awareness | traffic | conversions ...
  brief              text NOT NULL,
  is_paid            boolean NOT NULL DEFAULT false,
  planned_spend_cents bigint NOT NULL DEFAULT 0 CHECK (planned_spend_cents >= 0),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plan_items_schedule_idx ON plan_items (marketing_plan_id, scheduled_for);

-- -----------------------------------------------------------------------------
-- Creative production
-- -----------------------------------------------------------------------------
CREATE TABLE logo_requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  prompt               text NOT NULL,
  styles               text[] NOT NULL DEFAULT '{}',   -- wordmark, emblem, mascot...
  concept_count        integer NOT NULL DEFAULT 4 CHECK (concept_count BETWEEN 1 AND 12),
  status               request_status NOT NULL DEFAULT 'submitted',
  selected_creative_id uuid,                          -- FK added after creatives exists
  created_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE creatives (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  plan_item_id         uuid REFERENCES plan_items(id) ON DELETE SET NULL,
  content_request_id   uuid REFERENCES content_requests(id) ON DELETE SET NULL,
  logo_request_id      uuid REFERENCES logo_requests(id) ON DELETE CASCADE,
  parent_creative_id   uuid REFERENCES creatives(id) ON DELETE SET NULL,  -- regeneration lineage
  brand_profile_id     uuid REFERENCES brand_profiles(id) ON DELETE SET NULL,
  format               content_format NOT NULL,
  status               creative_status NOT NULL DEFAULT 'queued',
  concept              text,
  hook                 text,
  script               text,
  storyboard           jsonb NOT NULL DEFAULT '[]',   -- [{scene, visual, vo, duration_ms}]
  caption              text,
  hashtags             text[] NOT NULL DEFAULT '{}',
  call_to_action       text,
  brand_score          numeric(4,3) CHECK (brand_score BETWEEN 0 AND 1),
  rationale            text,                          -- why the agent made these choices
  feedback             text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX creatives_company_status_idx ON creatives (company_id, status);

ALTER TABLE logo_requests
  ADD CONSTRAINT logo_requests_selected_fk FOREIGN KEY (selected_creative_id) REFERENCES creatives(id) ON DELETE SET NULL;

CREATE TABLE creative_assets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id    uuid NOT NULL REFERENCES creatives(id) ON DELETE CASCADE,
  asset_id       uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  role           text NOT NULL,   -- final | thumbnail | voiceover | music | clip | frame | logo_svg | logo_png
  provider       text,            -- openai | runway | elevenlabs | creatomate ...
  provider_job_id text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (creative_id, asset_id)
);

-- -----------------------------------------------------------------------------
-- Paid media (TikTok Ads Manager mirror)
-- -----------------------------------------------------------------------------
CREATE TABLE audience_segments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  research_report_id uuid REFERENCES research_reports(id) ON DELETE SET NULL,
  name           text NOT NULL,
  age_groups     text[] NOT NULL DEFAULT '{}',   -- TikTok buckets: AGE_18_24, AGE_25_34 ...
  genders        text[] NOT NULL DEFAULT '{}',   -- GENDER_MALE | GENDER_FEMALE | GENDER_UNLIMITED
  location_ids   text[] NOT NULL DEFAULT '{}',
  languages      text[] NOT NULL DEFAULT '{}',
  interest_labels text[] NOT NULL DEFAULT '{}',          -- what the agent asked for, e.g. 'Food & Drink'
  interest_category_ids text[] NOT NULL DEFAULT '{}',    -- resolved TikTok ids
  action_category_ids   text[] NOT NULL DEFAULT '{}',  -- behaviours: watched/engaged with similar content
  hashtag_ids    text[] NOT NULL DEFAULT '{}',
  rationale      text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ad_campaigns (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  marketing_plan_id  uuid REFERENCES marketing_plans(id) ON DELETE SET NULL,
  tiktok_campaign_id text UNIQUE,
  name               text NOT NULL,
  objective          text NOT NULL,           -- REACH | TRAFFIC | VIDEO_VIEWS | CONVERSIONS ...
  budget_cents       bigint NOT NULL CHECK (budget_cents >= 0),
  status             ad_entity_status NOT NULL DEFAULT 'draft',
  starts_at          timestamptz,
  ends_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE ad_groups (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_campaign_id       uuid NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  audience_segment_id  uuid REFERENCES audience_segments(id) ON DELETE SET NULL,
  tiktok_adgroup_id    text UNIQUE,
  name                 text NOT NULL,
  optimization_goal    text NOT NULL,         -- CLICK | REACH | CONVERT ...
  bid_strategy         text NOT NULL DEFAULT 'LOWEST_COST',
  daily_budget_cents   bigint NOT NULL CHECK (daily_budget_cents >= 0),
  targeting_snapshot   jsonb NOT NULL,        -- exact payload sent to TikTok
  status               ad_entity_status NOT NULL DEFAULT 'draft',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_group_id      uuid NOT NULL REFERENCES ad_groups(id) ON DELETE CASCADE,
  creative_id      uuid NOT NULL REFERENCES creatives(id) ON DELETE RESTRICT,
  tiktok_ad_id     text UNIQUE,
  tiktok_video_id  text,
  ad_text          text NOT NULL,
  call_to_action   text,
  landing_url      text,
  status           ad_entity_status NOT NULL DEFAULT 'draft',
  rejection_reason text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ad_metrics_daily (
  ad_id              uuid NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
  date               date NOT NULL,
  spend_cents        bigint NOT NULL DEFAULT 0,
  impressions        bigint NOT NULL DEFAULT 0,
  reach              bigint NOT NULL DEFAULT 0,
  clicks             bigint NOT NULL DEFAULT 0,
  video_views        bigint NOT NULL DEFAULT 0,
  avg_watch_ms       integer NOT NULL DEFAULT 0,
  conversions        bigint NOT NULL DEFAULT 0,
  conversion_value_cents bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (ad_id, date)
);

-- -----------------------------------------------------------------------------
-- Organic publishing
-- -----------------------------------------------------------------------------
CREATE TABLE organic_posts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  creative_id      uuid NOT NULL REFERENCES creatives(id) ON DELETE RESTRICT,
  scheduled_for    timestamptz NOT NULL,
  privacy_level    text NOT NULL DEFAULT 'PUBLIC_TO_EVERYONE',
  tiktok_publish_id text,
  tiktok_post_id   text UNIQUE,
  share_url        text,
  status           post_status NOT NULL DEFAULT 'scheduled',
  error            text,
  published_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE post_metrics_daily (
  organic_post_id  uuid NOT NULL REFERENCES organic_posts(id) ON DELETE CASCADE,
  date             date NOT NULL,
  views            bigint NOT NULL DEFAULT 0,
  likes            bigint NOT NULL DEFAULT 0,
  comments         bigint NOT NULL DEFAULT 0,
  shares           bigint NOT NULL DEFAULT 0,
  saves            bigint NOT NULL DEFAULT 0,
  avg_watch_ms     integer NOT NULL DEFAULT 0,
  follows          bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (organic_post_id, date)
);

-- -----------------------------------------------------------------------------
-- Reporting, governance and automation audit
-- -----------------------------------------------------------------------------
CREATE TABLE monthly_reports (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  marketing_plan_id  uuid REFERENCES marketing_plans(id) ON DELETE SET NULL,
  research_report_id uuid REFERENCES research_reports(id) ON DELETE SET NULL,
  month              date NOT NULL CHECK (extract(day FROM month) = 1),
  status             run_status NOT NULL DEFAULT 'queued',
  summary            text,
  kpi_results        jsonb NOT NULL DEFAULT '[]',    -- [{metric, target, actual}]
  creative_breakdown jsonb NOT NULL DEFAULT '[]',    -- per-advert documentation
  logo_breakdown     jsonb NOT NULL DEFAULT '[]',
  recommendations    text,
  pdf_asset_id       uuid REFERENCES assets(id) ON DELETE SET NULL,
  sent_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, month)
);

-- Human-in-the-loop gate for anything public or that spends money.
CREATE TABLE approvals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  subject_type   text NOT NULL CHECK (subject_type IN ('marketing_plan', 'creative', 'ad_campaign', 'logo_request')),
  subject_id     uuid NOT NULL,
  decision       approval_decision NOT NULL DEFAULT 'pending',
  comment        text,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  decided_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at     timestamptz
);
CREATE INDEX approvals_pending_idx ON approvals (company_id) WHERE decision = 'pending';

-- Every n8n execution, with cost, for debugging and billing.
CREATE TABLE agent_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid REFERENCES companies(id) ON DELETE CASCADE,
  workflow           text NOT NULL,           -- brand-training | market-research | ...
  subject_type       text,
  subject_id         uuid,
  n8n_execution_id   text,
  status             run_status NOT NULL DEFAULT 'queued',
  input              jsonb NOT NULL DEFAULT '{}',
  output             jsonb,
  error              text,
  cost_cents         integer NOT NULL DEFAULT 0,
  idempotency_key    text UNIQUE,
  started_at         timestamptz,
  finished_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_runs_subject_idx ON agent_runs (subject_type, subject_id);

-- updated_at triggers
CREATE TRIGGER users_updated_at              BEFORE UPDATE ON users              FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER workspaces_updated_at         BEFORE UPDATE ON workspaces         FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER companies_updated_at          BEFORE UPDATE ON companies          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tiktok_connections_updated_at BEFORE UPDATE ON tiktok_connections FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER marketing_plans_updated_at    BEFORE UPDATE ON marketing_plans    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER creatives_updated_at          BEFORE UPDATE ON creatives          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER ad_campaigns_updated_at       BEFORE UPDATE ON ad_campaigns       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER ad_groups_updated_at          BEFORE UPDATE ON ad_groups          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER ads_updated_at                BEFORE UPDATE ON ads                FOR EACH ROW EXECUTE FUNCTION set_updated_at();
