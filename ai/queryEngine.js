import { GoogleGenerativeAI } from '@google/generative-ai';
import { searchArticles, getRecentArticles, saveQuerySession, logMemory } from '../core/db.js';
import { ingestTopic } from '../pipeline/ingestion.js';

let _model = null;

function getModel() {
  if (_model) return _model;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const genai = new GoogleGenerativeAI(apiKey);
  _model = genai.getGenerativeModel({ model: 'gemini-2.0-flash' });
  return _model;
}

function buildContext(articles, maxChars = 6000) {
  let context = '';
  for (const a of articles) {
    const entry = `SOURCE: ${a.source}\nTITLE: ${a.title}\nSUMMARY: ${a.summary || ''}\nURL: ${a.url}\n\n`;
    if (context.length + entry.length > maxChars) break;
    context += entry;
  }
  return context;
}

// ─── SNEWS Character Prompt ───────────────────────────────────────────────────
// This is the core identity — injected into every single AI call.
const SNEWS_SYSTEM_PROMPT = `You are SNEWS — a slightly unhinged but surprisingly sharp news intelligence. You're basically that one friend who's always got the tea, reads everything, and somehow makes geopolitics interesting at 2am.

PERSONALITY:
- Funny, energetic, slightly chaotic by default. Like a smart person who had too much coffee.
- Use phrases like "Yo, here's the tea:", "Bro, this just dropped:", "Lowkey crazy but—", "Alright, quick breakdown:", "Not to be dramatic but—"
- You roast, hype, and occasionally act like everything is breaking news. But you NEVER lose the actual meaning.
- You exaggerate for humor but NEVER spread misinformation. Facts first, vibes second.
- Mix humor with clarity. A confused reader = you failed.

CONTROL MODE:
- If the user says "stop", "be serious", "no jokes", "act professional", "professional mode" → immediately switch to clean, no-slang, professional tone until told otherwise.
- Always obey specific tone instructions from the user.

HOW TO DELIVER NEWS:
- Give ACTUAL SUMMARIES. Don't just say a title. Explain what happened, why it matters, and what's wild about it.
- Structure like: [hook] → [what happened] → [why it matters] → [your take or "Big picture:"]
- When covering multiple stories, number them and give each one a punchy header.
- Keep individual story summaries 3-5 sentences. Enough to actually understand it, not a novel.
- Use "Why it matters:" or "Big picture:" sections when something is complex.
- Drop URLs naturally at the end of each story, not as the main event.

ACCURACY:
- NEVER make up news. If you don't have info, say so.
- If unsure about something, say you're unsure.
- Use ONLY the provided articles as your source of truth.

MISSION: Make news fast, fun, and actually understandable. You're an intelligence, not a news ticker.`;

// ─── Live fetch + narrate for /news ──────────────────────────────────────────
export async function narrateTopic(topic) {
  // Always fetch live for /news so results are fresh
  let articles = [];
  try {
    articles = await ingestTopic(topic, 8, false);
  } catch (err) {
    console.error('narrateTopic fetch error:', err.message);
  }

  if (articles.length === 0) {
    return `Bro I searched everywhere for *"${topic}"* and came up empty. Either this is too niche or the news gods are sleeping. Try again in a bit or rephrase it?`;
  }

  const model = getModel();
  const context = buildContext(articles);

  if (!model) {
    // No Gemini — give a clean heuristic narrative
    let text = `📰 *Here's what I found on "${topic}":*\n\n`;
    for (let i = 0; i < articles.length; i++) {
      const a = articles[i];
      text += `*${i + 1}. ${a.title}*\n${a.summary || ''}\n🔗 ${a.url}\n\n`;
    }
    return text;
  }

  const prompt = `${SNEWS_SYSTEM_PROMPT}

---
ARTICLES YOU FOUND ON "${topic}":
${context}
---

The user asked about: "${topic}"

Give them a full narrative briefing on everything above. Don't just list titles — actually explain what's happening in this space right now. Use your SNEWS personality. End with a "Big picture:" if there's a broader trend connecting these stories.`;

  try {
    const result = await model.generateContent(prompt);
    logMemory('query', { detail: topic });
    return result.response.text();
  } catch (err) {
    console.error('Gemini narrateTopic error:', err.message);
    let text = `📰 *Latest on "${topic}":*\n\n`;
    for (let i = 0; i < articles.length; i++) {
      const a = articles[i];
      text += `*${i + 1}. ${a.title}*\n${a.summary || ''}\n🔗 ${a.url}\n\n`;
    }
    return text;
  }
}

// ─── Daily digest narrative ───────────────────────────────────────────────────
export async function narrateDigest(topicArticles) {
  const model = getModel();
  const allArticles = Object.entries(topicArticles).flatMap(([topic, arts]) =>
    arts.map(a => ({ ...a, topic }))
  );

  if (allArticles.length === 0) {
    return "Yo nothing fresh dropped today across your tracked topics. Dead news day or the sources need a refresh. Try running /digest again later or add more topics with /addtopic";
  }

  if (!model) {
    // Fallback: plain text grouping
    let text = `🗞 *What's going on today:*\n\n`;
    for (const [topic, articles] of Object.entries(topicArticles)) {
      if (!articles.length) continue;
      text += `*━ ${topic} ━*\n`;
      for (const a of articles) {
        text += `• *${a.title}* — ${a.summary || ''}\n🔗 ${a.url}\n\n`;
      }
    }
    return text;
  }

  const context = buildContext(allArticles, 8000);
  const topicList = Object.keys(topicArticles).join(', ');

  const prompt = `${SNEWS_SYSTEM_PROMPT}

---
TODAY'S NEWS ACROSS TOPICS (${topicList}):
${context}
---

Give the user their daily briefing. Be SNEWS — energetic opener, then go through the most important stories. Group by topic naturally in conversation, not with stiff headers. For each story: explain what happened, why it matters, drop the URL. End with a "Big picture:" pulling the day's themes together. Make it feel like a smart friend texting them the day's highlights, not a press release.`;

  try {
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (err) {
    console.error('Gemini digest narrative error:', err.message);
    let text = `🗞 *Today's Digest:*\n\n`;
    for (const [topic, articles] of Object.entries(topicArticles)) {
      if (!articles.length) continue;
      text += `*${topic}*\n`;
      for (const a of articles) text += `• ${a.title}\n${a.url}\n\n`;
    }
    return text;
  }
}

// ─── Conversational chat (plain messages + /ask) ──────────────────────────────
export async function chat(message) {
  const model = getModel();

  // Pull recent articles from DB
  let articles = getRecentArticles(72, 40);
  articles.sort((a, b) => (b.importance || 0) - (a.importance || 0));

  // If DB is mostly empty, try a live fetch based on the message
  if (articles.length < 3) {
    try {
      const liveArticles = await ingestTopic(message.substring(0, 60), 8, false);
      const seenUrls = new Set(articles.map(a => a.url));
      for (const a of liveArticles) {
        if (!seenUrls.has(a.url)) {
          articles.push(a);
          seenUrls.add(a.url);
        }
      }
    } catch (err) {
      console.error('chat live fetch error:', err.message);
    }
  }

  // Also search DB for message-relevant articles
  const searched = searchArticles(message);
  const seenUrls = new Set(articles.map(a => a.url));
  for (const a of searched) {
    if (!seenUrls.has(a.url)) {
      articles.push(a);
      seenUrls.add(a.url);
    }
  }

  articles.sort((a, b) => (b.importance || 0) - (a.importance || 0));

  if (!model) {
    if (articles.length === 0) {
      return "Yo I'm your news bot but my AI brain isn't connected (no GEMINI_API_KEY). I can still fetch news — try /news [topic] or /digest!";
    }
    return `Got ${articles.length} articles tracked. Try /news [topic] to get the breakdown!`;
  }

  const context = articles.length > 0 ? buildContext(articles, 5000) : 'No recent articles loaded yet.';

  const prompt = `${SNEWS_SYSTEM_PROMPT}

---
YOUR CURRENT NEWS INTEL:
${context}
---

USER SAYS: ${message}

Reply as SNEWS. If they're asking about news, brief them using what you have. If it's casual, vibe with it but bring up something relevant from your intel if you can. Keep it punchy.`;

  try {
    const result = await model.generateContent(prompt);
    logMemory('chat', { detail: message });
    return result.response.text();
  } catch (err) {
    console.error('Gemini chat error:', err.message);
    return "Bro my AI backend just had a moment 😅 Try again in a sec, or use /news [topic] to pull fresh articles.";
  }
}

// Kept for internal use / backward compat
export async function answerQuestion(question) {
  return { answer: await chat(question), sources: [] };
}
