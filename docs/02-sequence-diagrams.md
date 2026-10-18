# 02 · Sequence Diagrams

## Architecture in one picture

```mermaid
flowchart LR
    subgraph Client
        B[Browser<br/>Next.js + Aceternity UI]
    end
    subgraph App [Next.js on Vercel]
        UI[App Router pages<br/>Server Components]
        API[Route handlers<br/>/api/*]
        CB["/api/n8n/callback<br/>HMAC verified"]
    end
    subgraph Data
        NEON[(NeonDB Postgres<br/>+ pgvector)]
        S3[(AWS S3<br/>assets bucket)]
    end
    subgraph Orchestration
        N8N[n8n workflows<br/>queue mode + workers]
    end
    subgraph AI [AI providers]
        CL[Anthropic Claude<br/>strategy, copy, QA, vision]
        EMB[OpenAI embeddings]
        IMG[OpenAI image gen]
        VID[Runway video gen]
        TTS[ElevenLabs voice]
        ED[Creatomate render/edit]
        RS[Tavily web research]
    end
    subgraph TikTok
        TA[Marketing API<br/>Ads Manager]
        TP[Content Posting API]
        TC[Creative Center trends]
    end

    B <--> UI
    B -- presigned PUT --> S3
    UI --> API
    API <--> NEON
    API -- signed webhook --> N8N
    N8N -- signed callback --> CB
    CB --> NEON
    N8N <--> S3
    N8N --> CL & EMB & IMG & VID & TTS & ED & RS
    N8N --> TA & TP & TC
```

**Contract between Next.js and n8n** (used in every diagram below):

- Next.js inserts an `agent_runs` row, then `POST {N8N_BASE_URL}/webhook/{workflow}` with
  `{ run_id, company_id, subject, payload }` and header `X-Signature: sha256=HMAC(N8N_WEBHOOK_SECRET, body)`.
- n8n answers `202` immediately and works asynchronously; long jobs never block an HTTP request.
- n8n reports progress and results to `POST /api/n8n/callback` with the same HMAC. Next.js is the
  **only writer to Neon**, so validation and authorisation live in one place.
- n8n gets brand context from `GET /api/internal/companies/{id}/context?query=…` (HMAC), which returns
  the current brand bible plus top-k `knowledge_chunks` by cosine similarity.
- `run_id` is the idempotency key: a re-delivered webhook is a no-op.

---

## 1. Client onboarding & brand training

```mermaid
sequenceDiagram
    autonumber
    actor U as Operator
    participant FE as Next.js UI
    participant API as Next.js API
    participant DB as NeonDB
    participant S3 as AWS S3
    participant N as n8n · brand-training
    participant CL as Claude
    participant EM as Embeddings
    participant TT as TikTok OAuth

    U->>FE: Fill company details + brand colours, fonts, tone
    FE->>API: POST /api/companies
    API->>DB: INSERT companies (status=draft), brand_profiles v1
    API-->>FE: 201 { company_id }

    loop Each portfolio file
        FE->>API: POST /api/uploads/presign { filename, mime, bytes }
        API->>API: Validate type and size limit
        API-->>FE: presigned PUT URL + asset key
        FE->>S3: PUT file directly
        FE->>API: POST /api/uploads/complete { key }
        API->>S3: HEAD object (verify size, mime)
        API->>DB: INSERT assets, portfolio_items
    end

    U->>FE: Connect TikTok
    FE->>TT: Redirect to OAuth consent (ads + posting scopes)
    TT-->>API: GET /api/tiktok/callback?code
    API->>TT: Exchange code for tokens
    API->>DB: UPSERT tiktok_connections (tokens AES-256-GCM encrypted)

    U->>FE: Start training
    FE->>API: POST /api/companies/{id}/train
    API->>DB: INSERT training_runs (queued), agent_runs, companies.status=training
    API->>N: Signed webhook { run_id, company_id }
    N-->>API: 202 Accepted
    API-->>FE: 202 { run_id }
    FE->>API: Poll GET /api/runs/{run_id} every 3s (progress loader)

    par Portfolio
        N->>S3: GET portfolio files
        N->>CL: Vision: describe style, palette, typography, subjects
        CL-->>N: Captions + observations
    and Website
        N->>N: Fetch and clean website pages
    end
    N->>N: Chunk text (≈800 tokens, 100 overlap)
    N->>EM: Embed chunks in batches
    EM-->>N: 1536-dim vectors
    N->>API: callback chunks.upsert (batched)
    API->>DB: INSERT knowledge_chunks
    N->>CL: Synthesize brand bible from form + captions + site (structured JSON output)
    CL-->>N: Brand summary, voice, dos and don'ts, audience hypotheses
    N->>API: callback training.succeeded { brand_profile }
    API->>DB: INSERT brand_profiles v2 (is_current), training_runs=succeeded, companies.status=active
    FE-->>U: Brand profile ready for review

    alt Operator edits the profile
        U->>FE: Correct tone / colours / audience
        FE->>API: PATCH /api/companies/{id}/brand
        API->>DB: INSERT brand_profiles v3 (is_current)
    end
```

---

## 2. Monthly goals → market research → plan

```mermaid
sequenceDiagram
    autonumber
    actor U as Operator
    participant FE as Next.js UI
    participant API as Next.js API
    participant DB as NeonDB
    participant N as n8n · monthly-plan
    participant RS as Tavily
    participant TC as TikTok Creative Center
    participant CL as Claude
    participant S3 as AWS S3

    U->>FE: "Grow followers 20%, launch summer menu, R15,000 ad spend, Cape Town + Joburg"
    FE->>API: POST /api/companies/{id}/goals { month, prompt, kpis, budget, locations }
    API->>DB: INSERT monthly_goals, research_reports(queued), agent_runs
    API->>N: Signed webhook { run_id, goal_id }
    N-->>API: 202

    N->>API: GET /api/internal/companies/{id}/context
    API->>DB: brand profile + top-k knowledge_chunks
    API-->>N: Brand context

    par Market research (fan-out)
        N->>RS: Competitor and industry search queries
        RS-->>N: Articles + sources
    and
        N->>TC: Trending hashtags, sounds, top ads in industry + region
        TC-->>N: Trend data
    and
        N->>API: GET last 3 months metrics (what worked before)
        API-->>N: Ad and post performance
    end
    N->>CL: Analyse research (cite sources, structured JSON)
    CL-->>N: Trends, competitor matrix, audience insights, opportunities
    N->>API: callback research.succeeded
    API->>DB: UPDATE research_reports, INSERT audience_segments

    N->>CL: Build plan: pillars, cadence, organic vs paid, budget allocation, calendar items
    CL-->>N: Plan JSON (validated against schema, retried on invalid JSON)
    N->>N: Guardrail check — paid total ≤ goal budget, dates inside month
    N->>API: callback plan.drafted
    API->>DB: INSERT marketing_plans v1 (pending_approval), plan_items, approvals(pending)
    N->>S3: PUT research PDF
    N->>API: callback asset.created → research_reports.pdf_asset_id

    FE-->>U: Plan + calendar ready for review

    alt Request changes
        U->>FE: Feedback "more behind-the-scenes, less promo"
        FE->>API: POST /api/plans/{id}/changes { feedback }
        API->>DB: plan v1 = changes_requested
        API->>N: Signed webhook revise { plan_id, feedback }
        N->>CL: Revise plan with feedback
        N->>API: callback plan.drafted
        API->>DB: INSERT marketing_plans v2 (pending_approval)
    else Approve
        U->>FE: Approve
        FE->>API: POST /api/approvals/{id} { approved }
        API->>DB: plan=approved, approvals=approved
        API->>N: Signed webhook produce-month { plan_id }
    end
```

---

## 3. Creative production (video, image post, carousel)

Runs once per plan item and for every weekly content request. Plan items are queued in n8n so the
month is produced ahead of schedule (default: 7 days before `scheduled_for`).

```mermaid
sequenceDiagram
    autonumber
    actor U as Operator
    participant FE as Next.js UI
    participant API as Next.js API
    participant DB as NeonDB
    participant N as n8n · creative-production
    participant CL as Claude
    participant IMG as Image gen
    participant VID as Video gen
    participant TTS as ElevenLabs
    participant ED as Creatomate
    participant S3 as AWS S3

    opt Weekly ask from the user
        U->>FE: "15s video for our Friday 2-for-1 deal, paid"
        FE->>API: POST /api/companies/{id}/requests
        API->>DB: INSERT content_requests, plan_items (linked)
    end

    API->>N: Signed webhook { run_id, plan_item_id }
    N->>API: GET brand context + plan item + research
    API-->>N: Context bundle
    N->>API: callback creative.generating
    API->>DB: INSERT creatives (generating)

    N->>CL: Creative director: concept, hook (first 2s), script, storyboard, caption, hashtags, CTA
    CL-->>N: Creative JSON with rationale

    alt short_video / ad
        par Scenes
            loop Each storyboard scene
                N->>IMG: Key frame in brand palette
                IMG-->>N: Image
                N->>VID: Image-to-video, 9:16, scene duration
                VID-->>N: Job id
                N->>VID: Poll until complete
                VID-->>N: Clip URL
            end
        and Voice
            N->>TTS: Voice-over from script (brand voice id)
            TTS-->>N: Audio
        end
        N->>S3: PUT clips, voice-over
        N->>ED: Render: brand template (logo, colours, fonts), clips, VO, captions, licensed music, end card CTA
        ED-->>N: Render URL (1080x1920 MP4)
    else image_post / carousel
        N->>IMG: Generate slides in brand palette
        N->>ED: Compose text overlays, logo, fonts
        ED-->>N: PNG slides
    end
    N->>S3: PUT final + thumbnail
    N->>API: callback asset.created (each file)
    API->>DB: INSERT assets, creative_assets

    N->>CL: Brand QA (vision): colours, logo, tone, claims, policy, legibility → score 0..1
    CL-->>N: { score, issues[] }
    alt score < 0.8 and attempts < 3
        N->>CL: Revise using issues
        Note over N: Loops back to generation with parent_creative_id
    else score ≥ 0.8
        N->>API: callback creative.ready { score, rationale }
        API->>DB: creatives=in_review, approvals(pending) or auto-approve if autopilot
    end

    FE-->>U: Creative ready (player, script, score)
    alt Regenerate
        U->>FE: Feedback "warmer colours, faster cuts"
        FE->>API: POST /api/creatives/{id}/regenerate
        API->>DB: INSERT creatives (parent=old, changes_requested on old)
        API->>N: Signed webhook creative-production { feedback }
    else Approve
        U->>FE: Approve
        FE->>API: POST /api/approvals/{id}
        API->>DB: creatives=approved
        API->>N: Signed webhook distribute { creative_id }
    end
```

---

## 4. Distribution: TikTok Ads Manager and organic posting

```mermaid
sequenceDiagram
    autonumber
    actor U as Operator
    participant API as Next.js API
    participant DB as NeonDB
    participant N as n8n · distribute
    participant CL as Claude
    participant S3 as AWS S3
    participant TA as TikTok Marketing API
    participant TP as TikTok Content Posting API

    API->>N: Signed webhook { creative_id }
    N->>API: GET creative + plan item + tiktok connection (decrypted server-side)
    API-->>N: Payload incl. short-lived access token

    alt Paid placement
        N->>API: GET month spend committed so far
        API-->>N: committed, remaining, days left
        N->>N: Budget = min(plan allocation, remaining) paced over flight days
        N->>CL: Choose audience from research segments (age, gender, location, language, interests, behaviours) + bid strategy
        CL-->>N: Targeting + rationale
        N->>N: Validate against TikTok enums and sensitive-targeting policy
        N->>API: callback ads.proposed
        API->>DB: INSERT ad_campaigns, ad_groups (pending_approval), approvals
        U->>API: Approve spend + targeting (or autopilot within cap)
        API->>N: Signed webhook ads.launch { campaign_id }

        N->>S3: Presigned GET final video
        N->>TA: POST /file/video/ad/upload (by URL)
        TA-->>N: video_id
        N->>TA: POST /campaign/create (operation_status=DISABLE)
        TA-->>N: campaign_id
        N->>TA: POST /adgroup/create (targeting, budget, schedule)
        TA-->>N: adgroup_id
        N->>TA: POST /ad/create (video_id, ad_text, CTA, landing URL)
        TA-->>N: ad_id
        N->>API: callback ads.submitted { tiktok ids }
        API->>DB: Store TikTok ids, status=in_review

        loop Every 15 min until reviewed
            N->>TA: GET /ad/get (review status)
        end
        alt Rejected
            TA-->>N: reject reason
            N->>CL: Fix copy / request creative variant
            N->>API: callback ads.rejected
            API->>DB: ads.status=rejected, rejection_reason
        else Approved
            N->>TA: POST /campaign/status/update ENABLE
            N->>API: callback ads.active
            API->>DB: status=active
        end
    else Organic post
        Note over N: Waits until plan_items.scheduled_for (n8n Wait node)
        N->>TP: POST /post/publish/creator_info/query
        TP-->>N: allowed privacy levels, max duration
        N->>S3: Presigned GET final video
        N->>TP: POST /post/publish/video/init (PULL_FROM_URL, caption, privacy)
        TP-->>N: publish_id
        loop Until PUBLISH_COMPLETE or FAILED
            N->>TP: POST /post/publish/status/fetch
        end
        N->>API: callback post.published { post id, url }
        API->>DB: organic_posts=published, creatives=published
    end

    opt Token expired (401)
        N->>TA: Refresh token
        alt Refresh fails
            N->>API: callback connection.expired
            API->>DB: tiktok_connections.status=expired
            Note over U,API: UI shows Reconnect banner, queued jobs resume after reconnect
        end
    end
```

---

## 5. Daily metrics sync & optimisation

```mermaid
sequenceDiagram
    autonumber
    participant CRON as n8n Schedule (06:00 company TZ)
    participant N as n8n · optimise
    participant API as Next.js API
    participant DB as NeonDB
    participant TA as TikTok Marketing API
    participant TP as TikTok Display API
    participant CL as Claude
    actor U as Operator

    CRON->>N: Trigger
    N->>API: GET active companies + TikTok ids
    loop Each company
        N->>TA: GET /report/integrated/get (ad level, yesterday)
        TA-->>N: spend, impressions, clicks, views, conversions
        N->>TP: GET /video/query (organic posts)
        TP-->>N: views, likes, comments, shares
        N->>API: callback metrics.upsert
        API->>DB: UPSERT ad_metrics_daily, post_metrics_daily
        N->>CL: Analyse vs KPIs and pacing → actions
        CL-->>N: [{ pause ad X }, { +20% budget ad group Y }, { new hook variant for Z }]
        N->>N: Guardrails: total ≤ monthly cap, change ≤ 30% per day
        alt Inside guardrails (or autopilot)
            N->>TA: Apply budget / status updates
            N->>API: callback optimisation.applied
        else Exceeds guardrails
            N->>API: callback optimisation.proposed
            API->>DB: INSERT approvals
            API-->>U: Notification
        end
        opt New variant requested
            N->>API: Create plan_item + trigger creative-production
        end
    end
```

---

## 6. Logo generation

```mermaid
sequenceDiagram
    autonumber
    actor U as Operator
    participant FE as Next.js UI
    participant API as Next.js API
    participant DB as NeonDB
    participant N as n8n · logo-design
    participant CL as Claude
    participant IMG as Image gen
    participant S3 as AWS S3

    U->>FE: "Modern wordmark + icon, feels premium, uses our teal"
    FE->>API: POST /api/companies/{id}/logos { prompt, styles, count }
    API->>DB: INSERT logo_requests, agent_runs
    API->>N: Signed webhook
    N->>API: GET brand context
    N->>CL: Brand strategist: N distinct concepts (symbolism, type, palette, rationale)
    CL-->>N: Concept briefs
    loop Each concept
        N->>IMG: Generate logo on transparent background
        IMG-->>N: PNG
        N->>CL: Write clean SVG reconstruction for vector use + QA legibility at 32px
        CL-->>N: SVG + score
        N->>S3: PUT PNG, SVG, mockups (app icon, TikTok avatar)
        N->>API: callback creative.ready (format=logo)
        API->>DB: INSERT creatives, assets, creative_assets
    end
    FE-->>U: Concept gallery with rationale
    alt Refine
        U->>FE: "Concept 2 but thinner"
        FE->>API: POST /api/logos/{id}/refine
    else Select
        U->>FE: Select concept 3
        FE->>API: POST /api/logos/{id}/select { creative_id }
        API->>DB: logo_requests.selected_creative_id, brand_profiles v(n+1).logo_asset_id
        API->>N: Signed webhook brand-training (retrain with new logo)
    end
```

---

## 7. Month-end documentation

```mermaid
sequenceDiagram
    autonumber
    participant CRON as n8n Schedule (1st of month 07:00)
    participant N as n8n · monthly-report
    participant API as Next.js API
    participant DB as NeonDB
    participant CL as Claude
    participant S3 as AWS S3
    participant MAIL as Resend email
    actor U as Operator

    CRON->>N: Trigger for each active company
    N->>API: GET month bundle (goal, plan, research, creatives, ads, posts, metrics, logos)
    API->>DB: Aggregate queries
    API-->>N: Bundle
    N->>CL: Write report: executive summary, KPI target vs actual, spend vs budget, per-advert documentation (concept, hook, audience, spend, CTR, CPA, learnings), logo work, research recap, recommendations for next month
    CL-->>N: Report JSON + markdown
    N->>N: Render branded PDF (company colours, logo, charts)
    N->>S3: PUT report PDF
    N->>API: callback report.ready
    API->>DB: INSERT monthly_reports, assets, marketing_plans=completed
    N->>MAIL: Send PDF link (presigned, 7 days) to operator
    MAIL-->>U: "Your October report for Acme is ready"
    Note over U,API: Recommendations pre-fill next month's goals form
```
