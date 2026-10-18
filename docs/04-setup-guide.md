# 04 · Setup guide: API keys and n8n

Follow this once to take Marketing Agent from "works with mocks" to "posts real TikToks". Every value goes into
`.env` locally, and into your host's environment variables when you deploy. Run `npm run env:check` at any
point to see what's still missing.

> Provider dashboards move things around. If a menu name below doesn't match exactly, look for the closest
> equivalent. The value you need, and where it goes in `.env`, stays the same.

## 0 · Before you start

**Start the TikTok applications first.** TikTok reviews them by hand and it can take days, so begin
[steps 11 and 12](#11--tiktok-ads-manager-marketing-api) on day one and set up the rest while you wait.

```bash
npm install
npm run env:setup     # creates .env and generates AUTH_SECRET, ENCRYPTION_KEY, N8N_WEBHOOK_SECRET
```

Keep `MOCK_PROVIDERS=true` while you collect keys, so the app keeps working. Switch it to `false` once
everything is filled in.

| # | Service | `.env` keys | Needed for | Paid? |
|---|---|---|---|---|
| 1 | Neon | `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Everything (required in production) | Free tier |
| 2 | AWS S3 | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET` | Uploads, renders, reports | Pay as you go |
| 3 | Google OAuth | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Sign-in | Free |
| 4 | Anthropic | `ANTHROPIC_API_KEY` | Strategy, scripts, research, brand checks | Prepaid credits |
| 5 | OpenAI | `OPENAI_API_KEY` | Brand memory (embeddings), images | Prepaid credits |
| 6 | Runway | `RUNWAY_API_KEY` | Video clips | Credits, $10 minimum |
| 7 | ElevenLabs | `ELEVENLABS_API_KEY`, `ELEVENLABS_DEFAULT_VOICE_ID` | Voice-overs | Free tier, then paid |
| 8 | Creatomate | `CREATOMATE_API_KEY` | Editing and final renders | Free trial, then paid |
| 9 | Tavily | `TAVILY_API_KEY` | Market research | Free tier |
| 10 | Resend | `RESEND_API_KEY`, `EMAIL_FROM` | Report emails | Free tier |
| 11 | TikTok Marketing API | `TIKTOK_ADS_APP_ID`, `TIKTOK_ADS_APP_SECRET` | Ads | Free (you pay for ad spend) |
| 12 | TikTok for Developers | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | Organic posting | Free |
| 13 | n8n | `N8N_BASE_URL`, `N8N_API_KEY` | Running the agents | Free if self-hosted |

**Your app URL.** Several providers ask for a redirect URL built on your app's public address. Decide it now
(for example `https://agent.yourbrand.com`, or your Vercel URL) and put it in `NEXT_PUBLIC_APP_URL`. TikTok
requires `https`, so for local testing of TikTok sign-in use a tunnel such as `cloudflared tunnel --url
http://localhost:3000` or ngrok, and use the tunnel's URL.

---

## 1 · Neon (database)

1. Sign up at **neon.tech** and create a project. Pick the region closest to where you'll host the app.
2. On the project dashboard, click **Connect**.
3. With **Connection pooling** switched **on**, copy the string (its host contains `-pooler`) into `DATABASE_URL`.
4. Switch pooling **off**, copy that string into `DATABASE_URL_UNPOOLED`.
5. Create the tables:
   ```bash
   npm run db:migrate
   ```
   You should see `applied 0001-schema`.

## 2 · AWS S3 (file storage)

1. In the AWS console open **S3 › Create bucket**. Choose a name (e.g. `yourbrand-marketing-agent`) and a region,
   and leave **Block all public access** on. Put the name in `S3_BUCKET` and the region code (e.g. `eu-west-1`)
   in `AWS_REGION`.
2. Let browsers upload straight to the bucket: open `infra/s3-cors.json`, replace `https://YOUR-APP-DOMAIN`
   with your app URL, then in the bucket go to **Permissions › Cross-origin resource sharing (CORS) › Edit** and
   paste the `CORSRules` array. Or run:
   ```bash
   aws s3api put-bucket-cors --bucket <bucket> --cors-configuration file://infra/s3-cors.json
   ```
3. Create an access key that can only touch this bucket:
   - **IAM › Users › Create user**, name it `marketing-agent`, no console access.
   - On the user, **Add permissions › Create inline policy › JSON**, paste `infra/iam-policy.json` with your
     bucket name swapped in, and save.
   - **Security credentials › Create access key › Application running outside AWS**. Copy the two values into
     `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. The secret is shown only once.

## 3 · Google sign-in

1. Go to **console.cloud.google.com**, create (or pick) a project.
2. **APIs & Services › OAuth consent screen** (shown as *Google Auth Platform* in newer consoles): app name,
   support email, audience **External** (or **Internal** if you use Google Workspace and only your team signs in).
3. **Credentials › Create credentials › OAuth client ID › Web application.**
   Add **Authorized redirect URIs**:
   - `http://localhost:3000/api/auth/callback/google`
   - `https://<your app>/api/auth/callback/google`
4. Copy the **Client ID** into `AUTH_GOOGLE_ID` and the **Client secret** into `AUTH_GOOGLE_SECRET`.
5. While the consent screen is in *Testing*, add your team's emails as **Test users**.

Until these are set, development uses email-only sign-in. Production requires Google.

## 4 · Anthropic (Claude)

1. Sign in at **console.anthropic.com** (the Claude Console).
2. **Settings › Billing**: add a payment method and buy credits.
3. **Settings › API keys › Create key**, name it `marketing-agent`, and copy it into `ANTHROPIC_API_KEY`.
4. Leave `ANTHROPIC_MODEL=claude-opus-5-5` (main work) and `ANTHROPIC_FAST_MODEL=claude-haiku-5-5` (captions).

## 5 · OpenAI (embeddings and images)

1. Sign in at **platform.openai.com**, then **Settings › Billing** and add credits.
2. **API keys › Create new secret key**, and copy it into `OPENAI_API_KEY`.
3. Image generation (`gpt-image-1`) may require **organization verification** (Settings › Organization ›
   General › Verify). Do this now; it can take a little while. Embeddings work without it.

## 6 · Runway (video)

1. Sign up at **dev.runwayml.com** (the developer portal, separate from the Runway web app).
2. Create an **organization** for this integration.
3. **Billing**: add credits. The minimum top-up is $10.
4. **API Keys › Create key** and copy it into `RUNWAY_API_KEY`. It's shown only once.

## 7 · ElevenLabs (voice-over)

1. Sign in at **elevenlabs.io**, click your profile, open **API Keys**, create one and copy it into `ELEVENLABS_API_KEY`.
2. Choose a default voice: **Voices**, pick or design one, open it and copy its **Voice ID** into
   `ELEVENLABS_DEFAULT_VOICE_ID`. The template's default is a stock voice that works for testing.

## 8 · Creatomate (editing and rendering)

1. Sign up at **creatomate.com** and create a project.
2. Open **Project Settings**, reveal the **API Key** and copy it into `CREATOMATE_API_KEY`.
3. No templates needed. The app sends the full edit (clips, captions, logo, end card) with each render.

## 9 · Tavily (research)

1. Sign up at **tavily.com**; the dashboard shows an API key (starts with `tvly-`).
2. Copy it into `TAVILY_API_KEY`.

## 10 · Resend (email)

1. Sign up at **resend.com**, then **Domains › Add domain** (e.g. `yourbrand.com`) and add the DNS records it
   shows at your DNS provider. Wait for **Verified**.
2. **API Keys › Create API key** (Sending access) and copy it into `RESEND_API_KEY`.
3. Set `EMAIL_FROM` to an address on that domain, e.g. `reports@yourbrand.com`.

---

## 11 · TikTok Ads Manager (Marketing API)

This lets the agents create campaigns, set budgets and audiences, and read results.

1. Make sure you have a **TikTok for Business** account with access to the client's **Ads Manager**
   advertiser account (ads.tiktok.com).
2. Go to the **TikTok API for Business** portal (**business-api.tiktok.com**) and register as a developer.
3. **My Apps › Create new**:
   - **App name / description**: say what it does ("Agency tool that plans, launches and reports on TikTok ad
     campaigns for our clients").
   - **Advertiser redirect URL**: `https://<your app>/api/tiktok/callback/ads`
   - **Scopes / permissions**: request ad account management, campaign/ad group/ad management, creative
     (video and image upload), reporting, and audience and targeting tools.
4. Submit. Approval typically takes **2–3 business days**. Check **My Apps** for the status.
5. Once approved, open the app and copy the **App ID** into `TIKTOK_ADS_APP_ID` and the **Secret** into
   `TIKTOK_ADS_APP_SECRET`.
6. Keep `TIKTOK_SANDBOX=true` while testing with a sandbox advertiser, and set it to `false` to run real ads.
7. In the app, open each client's **Settings › Connect TikTok Ads Manager** and approve access with the account
   that owns the client's ad account.

## 12 · TikTok account posting (Content Posting API)

This lets the agents publish organic posts to the client's TikTok account.

1. Go to **developers.tiktok.com**, log in, and **Manage apps › Connect an app** (create an app).
2. Fill in the app details (icon, name, category, description, **Terms of Service** and **Privacy Policy**
   URLs; your website can host these).
3. **Add products**: **Login Kit** and **Content Posting API**. In Content Posting API, enable **Direct Post**.
4. **Scopes**: `user.info.basic`, `video.publish`, `video.list`.
5. **Login Kit › Redirect URI**: `https://<your app>/api/tiktok/callback/posting`
6. Copy the **Client key** into `TIKTOK_CLIENT_KEY` and the **Client secret** into `TIKTOK_CLIENT_SECRET`.
7. **Submit for review.** Until TikTok approves (audits) your app, posts can only be **private** (`SELF_ONLY`).
   The app detects this and tells you on the content page. You can test with sandbox/test users before then.
8. In the app, open each client's **Settings › Connect TikTok account** and sign in as the client's TikTok account.

**Videos** are uploaded directly by the server, so no domain verification is needed.
**Photo carousels** are different: TikTok only fetches photos from a domain you've verified. To use them:
- put the bucket behind your own domain (e.g. a CloudFront distribution on `media.yourbrand.com`),
- in the TikTok developer app, **URL properties › add domain**, then verify it with the DNS TXT record TikTok gives you,
- set `TIKTOK_MEDIA_BASE_URL=https://media.yourbrand.com`.

Without it, carousel posts fail with a message saying so, and videos are unaffected.

---

## 13 · n8n (runs the agents)

You don't build the n8n flows by hand: they're in the repo as `n8n/agent-runner.json` and
`n8n/scheduler.json`, and a script installs them. Here's how to host n8n, install the flows, and what's inside them.

### 13a · Host n8n

**Option A: on your computer (development).**

```bash
docker compose up -d        # uses docker-compose.yml, reads your .env
```

Open http://localhost:5678 and create the owner account. The compose file already sets everything the
flows need.

**Option B: a server (production, recommended).** Any host that runs the official Docker image works
(Railway, Render, DigitalOcean, Hetzner, a VPS). Use image `docker.n8n.io/n8nio/n8n` with a persistent volume
on `/home/node/.n8n`, and set these environment variables on n8n:

| Variable | Value |
|---|---|
| `N8N_WEBHOOK_SECRET` | the **same** value as in your app's `.env` |
| `APP_INTERNAL_URL` | your app's public URL, e.g. `https://agent.yourbrand.com` |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE` | `false` (the flows read the two values above) |
| `NODE_FUNCTION_ALLOW_BUILTIN` | `crypto` (the flows sign requests with Node's crypto) |
| `WEBHOOK_URL` | n8n's own public URL, e.g. `https://n8n.yourbrand.com/` |
| `GENERIC_TIMEZONE` | your timezone, e.g. `Africa/Johannesburg` (sets when the daily jobs run) |

If your n8n runs **task runners in external mode**, set `NODE_FUNCTION_ALLOW_BUILTIN` on the runner too.

**Option C: n8n Cloud.** You can't set environment variables there, so use the Cloud copies of the flows,
which read **Variables** instead. In n8n, open **Overview › Variables** (a paid-plan feature) and add
`N8N_WEBHOOK_SECRET` and `APP_INTERNAL_URL` with the values above. Then import with
`npm run n8n:import:cloud`. (Tested here: the self-hosted flows on n8n 2.43. The Cloud copies differ only in
reading `$vars` instead of `$env`.)

### 13b · Install the flows

1. In n8n: **Settings › n8n API › Create an API key**. Copy it into `N8N_API_KEY`.
2. Set `N8N_BASE_URL` to n8n's address (`http://localhost:5678`, or your public n8n URL).
3. Run:
   ```bash
   npm run n8n:import          # or: npm run n8n:import:cloud
   ```
   You'll see both flows created and activated. Running it again updates them in place.
4. In `.env` (and your host), set `DISPATCH_MODE=n8n` and restart the app.

Prefer clicking? In n8n choose **Create workflow › ⋯ › Import from file**, pick each JSON file, then switch it
**Active/Published**.

### 13c · What's inside the flows

**Agent runner**: one flow runs every job. Each job is a list of steps that run in the app; n8n calls them in
order and handles the waiting.

```
Job received (Webhook POST /webhook/agent-runner, replies 202 at once)
  → Verify signature   checks X-Signature/X-Timestamp with N8N_WEBHOOK_SECRET; rejects forged or >5-min-old jobs
  → Sign request       signs { run_id, step } the same way
  → Run step           POST {APP_INTERNAL_URL}/api/internal/steps  (retries 3×, 15-min timeout)
  → Next step          reads { done, next, waitSeconds } from the app
  → Finished?  ── yes → Done
               └─ no  → Needs a wait? ── yes → Wait (waitSeconds) → Sign request (loop)
                                       └─ no  → Sign request (loop)
```

The Wait node is what makes jobs durable. A video render waits 20 seconds, TikTok's ad review is checked every
15 minutes, and a post scheduled for Friday waits until Friday. Waits longer than about a minute are saved in
n8n's database, so restarts and deploys don't lose them.

**Scheduler**: three timers, each calling `{APP_INTERNAL_URL}/api/internal/cron/<job>` (signed):

| Trigger | Job | What happens |
|---|---|---|
| Every hour | `produce` | Starts production for approved plan items due in the next 7 days |
| Daily 06:00 | `optimise` | Syncs TikTok results and adjusts live ads (once per client per day) |
| Daily 07:00 | `monthly-reports` | Writes last month's report for each client (once per month) |

To change times, edit the trigger in n8n, or edit `scripts/build-n8n.mjs`, then run `npm run n8n:build` and import again.

### 13d · Check it works

1. Open any client and press **Retrain** on the Brand tab.
2. In n8n, **Executions** shows an *agent runner* execution. On the client's overview, the training progress
   moves through its steps.
3. If nothing happens:
   - **App can't reach n8n**: check `N8N_BASE_URL` from where the app runs. An app on Vercel can't reach
     `localhost`; n8n needs a public URL.
   - **n8n can't reach the app**: check `APP_INTERNAL_URL` from n8n. Inside Docker on your computer it's
     `http://host.docker.internal:3000` (already set in `docker-compose.yml`).
   - **"Invalid signature"** in n8n or a 401 in the app: `N8N_WEBHOOK_SECRET` differs between the two.
   - **"access to env vars denied"** or **"Cannot find module 'crypto'"**: the two n8n variables from 13a are missing.

---

## 14 · Turn it on

1. `npm run env:check` shows nothing missing (optional keys like `TIKTOK_MEDIA_BASE_URL` aren't required).
2. Set `MOCK_PROVIDERS=false` and `DISPATCH_MODE=n8n`.
3. Deploy (README › *Going live* step 7) with the same variables, and `NEXT_PUBLIC_APP_URL` set to the real URL.
4. **Settings** in the app lists every integration as *configured* or *missing*.
5. Do a first real run with a small budget: create a client, train, set goals with a modest ad budget, approve
   the plan, review the first video, and approve one ad. Watch it go *in review* and then *active* in the Ads tab.

**Rough cost per client per month** depends mostly on how much video you make (Runway and Creatomate are the
biggest line items, then Claude). Every run's model cost is recorded, and the client overview shows recent
agent cost, so you can watch it from day one.
