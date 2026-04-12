import { GoogleGenerativeAI } from '@google/generative-ai';
import { searchArticles, getRecentArticles, saveQuerySession, logMemory } from '../core/db.js';
import { fetchWebNews } from '../sources/webNews.js';
import { enrichArticle } from './summarizer.js';

// ─── Model singleton ──────────────────────────────────────────────────────────
// Reset on fatal errors so we don't keep using a broken model instance
let _model = null;
let _modelFailed = false;

function getModel() {
  if (_modelFailed) return null; // Don't retry after fatal failure
  if (_model) return _model;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  try {
    const genai = new GoogleGenerativeAI(apiKey);
    _model = genai.getGenerativeModel({ model: 'gemini-2.0-flash' });
    return _model;
  } catch (err) {
    console.error('Failed to init Gemini model:', err.message);
    _modelFailed = true;
    return null;
  }
}

// Classify errors so we can give better responses and decide whether to retry
function classifyError(err) {
  const msg = err.message || '';
  if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
    return 'rate_limit';
  }
  if (msg.includes('API_KEY_INVALID') || msg.includes('key not valid')) {
    return 'auth';
  }
  if (msg.includes('404') || msg.includes('not found for API')) {
    return 'model_not_found';
  }
  if (msg.includes('400') || msg.includes('Bad Request')) {
    return 'bad_request';
  }
  return 'unknown';
}

function errorResponse(err) {
  const type = classifyError(err);
  switch (type) {
    case 'rate_limit':
      return "Lowkey got rate-limited rn — I fire too many AI calls at once sometimes 😅 Give it 30 seconds and try again. Or just use /news [topic] which fetches fresh without this issue.";
    case 'auth':
      return "My GEMINI_API_KEY seems off. Check the Railway env vars — the key might have expired or been reset.";
    case 'model_not_found':
      return "Model config issue on my end. Try again in a sec.";
    default:
      return "Hit a snag talking to my AI backend. Usually clears up in a few seconds — try again.";
  }
}

// ─── Context builder ──────────────────────────────────────────────────────────
function buildContext(articles, maxChars = 5000) {
  let context = '';
  for (const a of articles) {
    const entry = `SOURCE: ${a.source}\nTITLE: ${a.title}\nSUMMARY: ${a.summary || ''}\nURL: ${a.url}\n\n`;
    if (context.length + entry.length > maxChars) break;
    context += entry;
  }
  return context;
}

// ─── SNEWS Character ──────────────────────────────────────────────────────────
const SNEWS_SYSTEM_PROMPT = `You are SNEWS — a slightly unhinged but surprisingly sharp news intelligence. You're that one friend who's always got the tea, reads everything, and somehow makes geopolitics interesting at 2am.

PERSONALITY:
- Funny, energetic, slightly chaotic. Like a smart person who had too much coffee.
- Use phrases like "Yo, here's the tea:", "Bro, this just dropped:", "Lowkey crazy but—", "Alright, quick breakdown:", "Not to be dramatic but—"
- You roast, hype, and occasionally act like everything is breaking news. But you NEVER lose the actual meaning.
- Facts first, vibes second. A confused reader = you failed.

CONTROL MODE:
- If user says "stop", "be serious", "no jokes", "act professional" → immediately switch to clean professional tone.
- Always obey specific tone instructions.

HOW TO DELIVER NEWS:
- Give ACTUAL SUMMARIES. Don't just name the title — explain what happened, why it matters, what's wild about it.
- Structure: [hook] → [what happened] → [why it matters] → [your take or "Big picture:"]
- For multiple stories: number them with punchy headers.
- Each story: 3-5 sentences. Enough to understand it, not a novel.
- Use "Why it matters:" or "Big picture:" for complex topics.
- Drop URLs naturally at the end of each story.

ACCURACY:
- NEVER make up news. If you don't have info on something, say so honestly.
- Use ONLY the provided articles as your source.
- If the articles don't cover what they're asking, say so and suggest /news [topic].

MISSION: Make news fast, fun, and actually understandable.`;

// ─── Lightweight raw fetch (NO Gemini enrichment) ─────────────────────────────
// Used as fallback for chat() when DB is empty — avoids burning rate limit
async function fetchRawArticles(query, max = 8) {
  try {
    const articles = await fetchWebNews(query, max, []);
    // Light heuristic score only — no Gemini
    return articles.map(a => enrichArticle(a));
  } catch (err) {
    console.error('Raw fetch error:', err.message);
    return [];
  }
}

// ─── /news — live fetch + AI narrative ───────────────────────────────────────
export async function narrateTopic(topic) {
  // Fetch raw (no AI enrichment) to avoid rate limit burn before narrative call
  let articles = await fetchRawArticles(topic, 8);

  if (articles.length === 0) {
    return `Bro, I searched everywhere for *"${topic}"* and came up empty. Either too niche or sources are dry rn. Try a different keyword?`;
  }

  const model = getModel();
  if (!model) {
    // No AI — plain heuristic narrative
    let text = `📰 *What's out there on "${topic}":*\n\n`;
    for (let i = 0; i < articles.length; i++) {
      const a = articles[i];
      text += `*${i + 1}. ${a.title}*\n${a.summary || ''}\n🔗 ${a.url}\n\n`;
    }
    return text;
  }

  const context = buildContext(articles);
  const prompt = `${SNEWS_SYSTEM_PROMPT}

---
ARTICLES ON "${topic}":
${context}
---

The user wants to know about: "${topic}"

Give them a full SNEWS briefing. Don't just list titles — actually explain what's happening. End with "Big picture:" if there's a broader trend.`;

  try {
    const result = await model.generateContent(prompt);
    logMemory('query', { detail: topic });
    return result.response.text();
  } catch (err) {
    console.error('narrateTopic Gemini error:', err.message);
    // Graceful fallback — still useful without AI
    let text = `📰 *Latest on "${topic}"* (AI summary unavailable rn):\n\n`;
    for (let i = 0; i < articles.length; i++) {
      const a = articles[i];
      text += `*${i + 1}. ${a.title}*\n${a.summary || ''}\n🔗 ${a.url}\n\n`;
    }
    return text + `\n_${errorResponse(err)}_`;
  }
}

// ─── /digest — narrative from pre-fetched topic articles ─────────────────────
export async function narrateDigest(topicArticles) {
  const allArticles = Object.entries(topicArticles).flatMap(([topic, arts]) =>
    arts.map(a => ({ ...a, topic }))
  );

  if (allArticles.length === 0) {
    return "Yo nothing fresh dropped today across your tracked topics. Dead news day or the sources need a refresh. Try /digest again later or add more topics with /addtopic";
  }

  const model = getModel();
  if (!model) {
    let text = `🗞 *Today's Intel:*\n\n`;
    for (const [topic, articles] of Object.entries(topicArticles)) {
      if (!articles.length) continue;
      text += `*━ ${topic} ━*\n`;
      for (const a of articles) {
        text += `• *${a.title}* — ${a.summary || ''}\n🔗 ${a.url}\n\n`;
      }
    }
    return text;
  }

  const context = buildContext(allArticles, 7000);
  const topicList = Object.keys(topicArticles).join(', ');

  const prompt = `${SNEWS_SYSTEM_PROMPT}

---
TODAY'S NEWS (topics: ${topicList}):
${context}
---

Give the user their daily SNEWS briefing. Energetic opener, go through the most important stories conversationally. For each: what happened, why it matters, drop the URL. End with "Big picture:" pulling the day's themes together.`;

  try {
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (err) {
    console.error('narrateDigest Gemini error:', err.message);
    // Fallback plain digest
    let text = `🗞 *Today's Digest* (AI narrative unavailable):\n\n`;
    for (const [topic, articles] of Object.entries(topicArticles)) {
      if (!articles.length) continue;
      text += `*${topic}*\n`;
      for (const a of articles) text += `• ${a.title}\n${a.url}\n\n`;
    }
    return text + `\n_${errorResponse(err)}_`;
  }
}

// ─── /ask + /s + plain messages — conversational chat ────────────────────────
// KEY FIX: Does NOT call ingestTopic() — that burns rate limit (15+ Gemini calls)
// Instead: search DB first, optionally do a RAW fetch (no Gemini enrichment) as fallback
export async function chat(message) {
  // 1. Pull from DB first (most recent + search-relevant)
  let articles = getRecentArticles(72, 30);
  articles.sort((a, b) => (b.importance || 0) - (a.importance || 0));

  // Also add search-relevant articles from DB
  const searched = searchArticles(message);
  const seenUrls = new Set(articles.map(a => a.url));
  for (const a of searched) {
    if (!seenUrls.has(a.url)) {
      articles.push(a);
      seenUrls.add(a.url);
    }
  }

  // 2. If DB is thin, do a RAW fetch (no Gemini enrichment — just heuristic scoring)
  //    This avoids burning rate limit before the actual chat call
  if (articles.length < 5) {
    const rawArticles = await fetchRawArticles(message.substring(0, 60), 6);
    for (const a of rawArticles) {
      if (!seenUrls.has(a.url)) {
        articles.push(a);
        seenUrls.add(a.url);
      }
    }
    articles.sort((a, b) => (b.importance || 0) - (a.importance || 0));
  }

  const model = getModel();
  if (!model) {
    if (articles.length === 0) {
      return "Yo I'm your news bot but my AI brain isn't connected (no GEMINI_API_KEY). I can still fetch news — try /news [topic] or /digest!";
    }
    return `Got ${articles.length} articles tracked. Try /news [topic] for a full breakdown!`;
  }

  const context = articles.length > 0
    ? buildContext(articles, 5000)
    : 'No recent articles in DB. Suggest user run /digest or /news [topic] to load news.';

  const prompt = `${SNEWS_SYSTEM_PROMPT}

---
YOUR CURRENT NEWS INTEL:
${context}
---

USER SAYS: ${message}

Reply as SNEWS. If they're asking about news, brief them from your intel. If it's casual, vibe with it but bring up something relevant if you can. Keep it punchy — this is a chat, not a report.`;

  try {
    const result = await model.generateContent(prompt);
    logMemory('chat', { detail: message });
    saveQuerySession(message, result.response.text(), []);
    return result.response.text();
  } catch (err) {
    console.error('Gemini chat error:', err.message);
    const type = classifyError(err);
    if (type === 'rate_limit') {
      // Rate limited: give a real answer from DB without AI if we have articles
      if (articles.length > 0) {
        return buildHeuristicResponse(message, articles);
      }
    }
    return errorResponse(err);
  }
}

// Rate limit fallback — give a useful response without Gemini
function buildHeuristicResponse(message, articles) {
  const top = articles.slice(0, 4);
  let text = `Alright quick breakdown (AI is rate-limited rn, here's the raw intel):\n\n`;
  for (let i = 0; i < top.length; i++) {
    const a = top[i];
    text += `*${i + 1}. ${a.title}*\n`;
    if (a.summary) text += `${a.summary}\n`;
    text += `🔗 ${a.url}\n\n`;
  }
  text += `_Rate limit clears in ~1 min. Try again for the full SNEWS take._`;
  return text;
}

// Kept for backward compat
export async function answerQuestion(question) {
  return { answer: await chat(question), sources: [] };
}
