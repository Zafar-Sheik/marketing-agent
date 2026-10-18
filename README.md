# Marketing Agent — autonomous TikTok marketing agency

Create a client, give it the brand (colours, name, details, portfolio), and the system learns the brand,
researches the market, writes the monthly plan, designs and edits the videos, posts and adverts, buys the
media in TikTok Ads Manager with a calculated budget and audience, publishes, optimises daily, designs
logos on request, and documents everything in a monthly report.

**Stack:** Next.js (App Router) + Aceternity UI · n8n (orchestration) · NeonDB Postgres + pgvector · AWS S3 ·
Claude (strategy, copy, QA) · OpenAI (embeddings, images) · Runway (video) · ElevenLabs (voice) ·
Creatomate (editing/render) · Tavily (research) · TikTok Marketing API + Content Posting API · Resend (email)

## Design documents

| | Document | What's inside |
|---|---|---|
| 1 | [User flow](docs/01-user-flow.md) | End-to-end flow with approval gates, screen map, creative/plan/ad state machines, guardrails |
| 2 | [Sequence diagrams](docs/02-sequence-diagrams.md) | Architecture, Next.js ↔ n8n contract, 7 sequences: onboarding & training, research & plan, creative production, ads + organic distribution, daily optimisation, logos, month-end report |
| 3 | [ERD](docs/03-erd.md) | 28 tables, relationships, design decisions |
| — | [`db/schema.sql`](db/schema.sql) | The Neon schema the ERD is drawn from |

GitHub renders the Mermaid diagrams inline. Pre-rendered SVGs are in [`docs/diagrams/`](docs/diagrams/).

## Tested

```bash
npm install
npm test
```

- `test:diagrams` renders every Mermaid block in `docs/` with the real Mermaid engine in headless Chromium.
  A diagram with a syntax error fails the build.
- `test:schema` loads `db/schema.sql` into an in-memory Postgres (PGlite + pgvector), checks that **every
  table, column and relationship in the ERD exists in the schema** (so the diagram can't drift), and runs a
  full client lifecycle: onboarding → embeddings + similarity search → goals → versioned plan → creative
  lineage → campaign/ad group/ad/metrics → organic post → logo → report, plus the constraints that block
  duplicate months, over-negative budgets, non-hex brand colours, double-executed n8n runs and deleting a
  creative that has spend behind it.
- `test:env` checks the `.env` tooling below.

CI runs the same `npm test` on every push.

## Environment — you only paste API keys

```bash
npm run env:setup   # creates .env, generates all internal secrets
# paste your keys over each `replace-me`
npm run env:check   # lists anything still missing
```

## Things to know before building

- **"Training" = retrieval (RAG), not model fine-tuning.** Client material is embedded into pgvector and
  retrieved into every prompt. It's instant, cheap and keeps each client's data isolated.
- **TikTok does not allow targeting by religion** (or other sensitive characteristics). The system targets on
  age, gender, location, language, interests, behaviours, hashtags and custom/lookalike audiences, and
  handles faith or cultural moments through creative, timing, language and location.
- **TikTok app approval is required.** The Marketing API needs an approved developer app per advertiser, and the
  Content Posting API posts as private until TikTok audits your app. Start with `TIKTOK_SANDBOX=true`.
- **Money is gated.** Campaigns are created paused, the monthly budget is a hard cap, and spend and publishing
  need approval unless the workspace is switched to autopilot.

## Build roadmap

1. Next.js app shell, Auth.js, Drizzle models generated from `db/schema.sql`, S3 presigned uploads
2. Onboarding wizard + `brand-training` n8n workflow
3. Goals → `monthly-plan` workflow (research + plan + approvals)
4. `creative-production` workflow (video, image, carousel) + review screen
5. `distribute` workflow (TikTok Ads + Content Posting) + OAuth
6. `optimise` daily workflow, `logo-design`, `monthly-report` PDF
