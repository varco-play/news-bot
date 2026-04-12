# Jarvis Intelligence Bot — Quick Start Guide (Free Tier)

Get the bot running in 15 minutes using **only free options** — no credit card required.

---

## What You'll Need

1. **Telegram** — Download the app (free) at https://telegram.org
2. **Node.js 18+** — Download at https://nodejs.org
3. **Free API keys** — All listed below are free tier (no credit card)

---

## Step 1: Set Up Telegram (5 minutes)

### 1a. Create Your Bot

1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. BotFather asks for a name → type: `MyNewsBot` (or any name)
4. BotFather asks for username → type: `my_news_bot_XXXX` (must end with `_bot`, X = random chars)
5. BotFather replies with a **TOKEN** that looks like: `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`
6. **Save this token** — you'll need it in 5 minutes

### 1b. Get Your Chat ID

1. In Telegram, search for **@userinfobot**
2. Send any message to it
3. It replies with JSON. Find the number after `"id":` → that's your **CHAT_ID** (looks like: `987654321`)
4. **Save this chat ID**

---

## Step 2: Get Free API Keys (5 minutes)

### 2a. NewsAPI (Free — 100 requests/day)
1. Go to https://newsapi.org/register
2. Sign up with email
3. Copy your API key from the dashboard
4. **Save as NEWS_API_KEY**

### 2b. Reddit (Free — Unlimited)
1. Log in to Reddit
2. Go to https://www.reddit.com/prefs/apps
3. Click **Create Another App**
4. Name: `NewsBot`, Type: **script**, Redirect URI: `http://localhost`
5. Click **Create App**
6. Copy the **client ID** (under the app name) and **secret**
7. **Save as REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET**

### 2c. Twitter/X (Free — Read Only)
1. Go to https://developer.twitter.com/en/portal/dashboard
2. Create a project → Create an app
3. Go to **Keys and tokens** tab
4. Generate **Bearer Token**
5. **Save as TWITTER_BEARER_TOKEN**

### 2d. Instagram via Apify (Optional — Free $5/month)
1. Go to https://apify.com → Sign Up Free
2. Log in → Avatar → Settings → Integrations
3. Create Personal API Token
4. **Save as APIFY_API_TOKEN**

### 2e. Google Gemini (Optional — For AI Features — Truly Free)
1. Go to https://aistudio.google.com/apikey
2. Click **Create API Key**
3. Create a new project (or use default)
4. Google generates your free API key instantly (looks like: `AIza...`)
5. Copy it
6. **Save as GEMINI_API_KEY**
   - No credit card needed — completely free
   - No expiration — free tier is permanent
   - Rate limit: 15 requests per minute (plenty for daily digests + alerts)
   - If you don't add this, the bot still works with heuristic scoring

---

## Step 3: Configure the Bot (2 minutes)

1. Open the `news-bot` folder
2. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
3. Open `.env` in a text editor
4. Fill in these lines with the values you saved:
   ```
   TELEGRAM_BOT_TOKEN=<paste your BotFather token here>
   TELEGRAM_CHAT_ID=<paste your chat ID from userinfobot here>
   NEWS_API_KEY=<paste your newsapi.org key here>
   REDDIT_CLIENT_ID=<paste your Reddit client ID here>
   REDDIT_CLIENT_SECRET=<paste your Reddit secret here>
   TWITTER_BEARER_TOKEN=<paste your Twitter token here>
   GEMINI_API_KEY=<paste your Gemini key here - optional>
   ```

---

## Step 4: Install & Run (2 minutes)

```bash
cd news-bot
npm install
node main.js
```

You should see:
```
✅ Database initialized.
[Scheduler] Daily digest at 08:00 UTC
[Scheduler] Alert polling every 30min
🤖 Jarvis Intelligence Bot is running! Press Ctrl+C to stop.
```

---

## Step 5: Test It! (1 minute)

Open Telegram and send these commands to your bot:

| Command | What It Does |
|---------|-------------|
| `/start` | Welcome message + verify connection |
| `/digest` | Get today's top stories (30-60 seconds) |
| `/news openai` | Search for OpenAI news |
| `/ask What happened with OpenAI?` | Ask a question (AI-powered) |
| `/top` | Top 5 stories from last 48h |
| `/addtopic Bitcoin` | Add a new topic to monitor |
| `/help` | Full command list |

---

## How Much Will This Cost?

**Total monthly cost (all free!):**
- NewsAPI: Free (100 req/day)
- Reddit: Free
- Twitter: Free
- Google News: Free
- Google Gemini (if enabled): $0 free tier (15 req/min, no credit card, no expiration)

**Fully free-tier cost: $0** (including AI features!)

---

## Common Issues

### "Cannot find module 'better-sqlite3'"
```bash
npm install
```

### "TELEGRAM_BOT_TOKEN not set"
Make sure `.env` file exists and has no spaces around `=`.

### "/digest times out"
First run takes 30-60 seconds to fetch from all sources. Be patient.

### "ETELEGRAM: 401 Unauthorized"
Your bot token is wrong. Get a new one from @BotFather.

---

## Running 24/7 on a Server

```bash
# Option 1: Simple background
nohup node main.js > bot.log 2>&1 &

# Option 2: With PM2 (recommended)
npm install -g pm2
pm2 start main.js --name jarvis-bot
pm2 save
pm2 startup
```
