# Marketing Agent: an autonomous TikTok marketing agency

Add a client with their brand colours, details and past work. Tell it this month's goals and, if you like, what to make this week. The agents learn the brand, research the market, write the monthly plan, script, design, generate and edit the videos and posts, put the right budget and audience behind them in TikTok Ads Manager, publish, optimise daily, design logos on request, and send a documented monthly report. Anything that spends money or goes public waits for your approval, unless you switch on autopilot.

**Stack:** Next.js 16 (App Router, Server Actions) with Aceternity-style UI · n8n (durable orchestration) · NeonDB Postgres with pgvector · AWS S3 · Claude (strategy, copywriting, research analysis, brand QA, vision) · OpenAI (embeddings, images) · Runway (video) · ElevenLabs (voice-over) · Creatomate (editing) · Tavily (research) · TikTok Marketing API and Content Posting API · Resend (email)

## Try it in two minutes, no keys needed

```bash
npm install
npm run env:setup            # creates .env with generated secrets
# in .env set: MOCK_PROVIDERS=true   (simulates every provider and TikTok; spends nothing)
npm run dev                  # http://localhost:3000
```

With no keys, the app uses an embedded Postgres in `.data/`, stores uploads on disk, runs the agents inside the Next.js server (`DISPATCH_MODE=inline`), and lets you sign in with just an email. The whole flow works end to end: client, training, plan, content, approvals, ads, posts, logos and the PDF report, with placeholder media.

## Going live: you only paste API keys

1. **Keys.** Open `.env` and replace each `replace-me`. `npm run env:check` lists what is still missing. Set `MOCK_PROVIDERS=false`.
2. **Neon.** Create a project, paste the pooled `DATABASE_URL` and the direct `DATABASE_URL_UNPOOLED`, then run `npm run db:migrate`.
3. **S3.** Create a private bucket, set `S3_BUCKET` and `AWS_REGION`, and apply `infra/s3-cors.json` (add your domain) so browsers can upload straight to S3:
   `aws s3api put-bucket-cors --bucket <bucket> --cors-configuration file://infra/s3-cors.json`
4. **n8n.** `docker compose up -d`, open http://localhost:5678, create an API key (Settings › n8n API), put it in `N8N_API_KEY`, then run `npm run n8n:import` and set `DISPATCH_MODE=n8n`. For a hosted n8n, set `N8N_BASE_URL` and give n8n the env vars `N8N_WEBHOOK_SECRET`, `APP_INTERNAL_URL` (your app's URL), `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` and `NODE_FUNCTION_ALLOW_BUILTIN=crypto`.
5. **Google sign-in.** Create an OAuth client with redirect `https://<app>/api/auth/callback/google` and fill in `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`. While these are empty in development, email-only sign-in is used.
6. **TikTok.**
   - *Ads:* create a Marketing API app at business-api.tiktok.com with redirect `https://<app>/api/tiktok/callback?kind=ads`, then fill in `TIKTOK_ADS_APP_ID` and `TIKTOK_ADS_APP_SECRET`.
   - *Organic posting:* create an app at developers.tiktok.com with Login Kit and Content Posting API, redirect `https://<app>/api/tiktok/callback?kind=posting`, then fill in `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`. Verify your S3 or app domain for `PULL_FROM_URL`.
   - Keep `TIKTOK_SANDBOX=true` until TikTok approves the apps.
7. **Deploy to Vercel.** Import the repo. `vercel.json` pins the Next.js framework and its output directory, so a wrong dashboard preset or Output Directory can't break the build. Add your `.env` values under Settings › Environment Variables, and set `NEXT_PUBLIC_APP_URL` to the deployed URL.
   - On Vercel you must use Neon (`DATABASE_URL`). Serverless file systems are read-only, so the embedded database is for local use only, and the app says so if it's missing.
   - Use `DISPATCH_MODE=n8n`. Inline mode's background scheduler needs a long-running server, which Vercel functions aren't.
   - Each agent step runs within the 300-second function limit available on every Vercel plan.

## How it works

| | |
|---|---|
| [User flow](docs/01-user-flow.md) | Screens, approval gates, state machines, guardrails |
| [Sequence diagrams](docs/02-sequence-diagrams.md) | Architecture, the Next.js ↔ n8n contract, every workflow step by step |
| [ERD](docs/03-erd.md) | 28 tables and why they are shaped the way they are |

Every automated job is a workflow of small TypeScript steps in `src/lib/workflows/`. n8n's single **agent-runner** workflow calls `/api/internal/steps` for each one. It waits as long as each step asks (a video render, TikTok ad review, the scheduled post time) and those waits survive restarts. The **scheduler** workflow triggers content production hourly, ad optimisation daily, and monthly reports.

| Workflow | What it does |
|---|---|
| `brand-training` | Captions the portfolio with vision, reads the website, embeds everything into pgvector brand memory, and writes a versioned brand bible |
| `monthly-plan` | Researches trends, competitors and audiences (with citations), then writes the strategy, pillars, budget split and a dated content calendar inside the budget |
| `creative-production` | Writes the concept, hook, script and storyboard; creates key frames, video clips and voice-over; does a branded edit (captions, logo, end card); then runs a vision brand-QA. Anything scoring below 0.8 is remade (up to 3 attempts) |
| `ads-propose` → `ads-launch` | Calculates the budget (capped by what is left this month, paced over the flight) and picks the audience from the research. After approval, creates the campaign in TikTok *paused*, waits for TikTok review, then enables it |
| `organic-publish` | Waits for the scheduled time, then publishes the video or photo carousel and confirms it went live |
| `optimise` | Daily metrics sync, then budget shifts, pauses and new-variant requests within guardrails; anything bigger asks you |
| `logo-design` | Brand-aware logo concepts as transparent PNGs. Picking one makes it the brand logo |
| `monthly-report` | KPI results, documentation for every advert and logo, research recap and recommendations, as a branded PDF, emailed to you |

## Tested

```bash
npm test          # typecheck, unit + integration, schema, env tooling, diagrams
npm run test:e2e  # real browser, full operator journey (offline providers)
```

- **Unit tests:** budget pacing and caps, guardrails, TikTok targeting (including refusal of sensitive targeting), crypto and webhook signatures, dates, text chunking, colours.
- **Integration tests:** a whole client month runs end to end against a real Postgres engine with the actual workflows, plus the failure paths (low brand score, provider failure, TikTok rejection, budget cap, autopilot, replayed n8n steps, double approvals).
- **Consistency tests:** the Drizzle models, `db/schema.sql` and the ERD must match exactly, and every Mermaid diagram must render.
- **n8n tests:** the workflow files are checked, and their signing code is run and verified against the app's verifier.
- **End-to-end:** Playwright drives the real app through sign-in, the new-client wizard, upload, training, planning, approvals, content, ads, posting, logos and the report PDF.

## Things to know

- **"Trained on the brand" means retrieval, not fine-tuning.** Each client's material is embedded and retrieved into every prompt, kept separate per client.
- **TikTok doesn't allow religion targeting** (or other sensitive characteristics). Targeting uses age (18+), gender, location, language, interests and behaviours. Faith and cultural moments are handled through the creative, timing, language and location. Segments that use sensitive terms are rejected in code.
- **Money is gated.** Each month has a hard budget cap that is re-checked right before anything is sent to TikTok. Campaigns are created paused and only enabled after your approval and TikTok's review. The optimiser can't raise the month's total.
- **Unaudited TikTok posting apps can only post privately.** The app detects this and tells you.
- **Video length:** generated scenes are 5 or 10 seconds, so videos run about 15–30 seconds plus an end card.

## Scripts

| | |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run env:setup` / `env:check` | Create `.env` and check what is missing |
| `npm run db:migrate` | Apply `db/schema.sql` and `db/migrations/*.sql` to Neon |
| `npm run n8n:import` | Install and activate the n8n workflows |
| `npm run n8n:build` | Regenerate `n8n/*.json` from `scripts/build-n8n.mjs` |
| `npm run diagrams:render` | Re-render `docs/diagrams/*.svg` |
