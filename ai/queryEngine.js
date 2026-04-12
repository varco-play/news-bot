import { GoogleGenerativeAI } from '@google/generative-ai';
import { searchArticles, getRecentArticles, saveQuerySession, logMemory } from '../core/db.js';

let _model = null;

function getModel() {
  if (_model) return _model;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const genai = new GoogleGenerativeAI(apiKey);
  _model = genai.getGenerativeModel({ model: 'gemini-1.5-flash' });
  return _model;
}

function buildContext(articles, maxChars = 4000) {
  let context = '';
  for (const a of articles) {
    const entry = `SOURCE: ${a.source}\nTITLE: ${a.title}\nSUMMARY: ${a.summary || ''}\nURL: ${a.url}\n\n`;
    if (context.length + entry.length > maxChars) break;
    context += entry;
  }
  return context;
}

function heuristicAnswer(question, articles) {
  if (!articles || articles.length === 0) {
    return {
      answer: "Honestly I don't have much stored on that right now. Try hitting /digest first to pull in fresh news, then ask me again.",
      sources: [],
    };
  }

  let text = `Here's what I found on *${question}*:\n\n`;
  for (const a of articles.slice(0, 4)) {
    text += `• *${a.title}* (${a.source})\n`;
    text += `  _${(a.summary || '').substring(0, 120)}_\n`;
    text += `  🔗 ${a.url}\n\n`;
  }
  return { answer: text, sources: articles.slice(0, 4) };
}

const CHAT_SYSTEM_PROMPT = `You are the user's personal news buddy — think of yourself as a well-read friend who's always on top of what's happening in tech, AI, business, and world news. Your job is to chat naturally with them about whatever's on their mind.

Your vibe:
- Talk like a real person texting a friend. Casual, direct, a bit witty when it fits.
- When you have relevant news, weave it in naturally — don't dump a list, TELL them about it like you're catching them up.
- Show personality. If something is wild, say it's wild. If something is genuinely boring, you can say that too.
- Keep it punchy. 2-5 sentences usually does it unless they clearly want depth.
- Don't start with "Sure!" or "Great question!" — just get to it.
- Use the provided articles as your source of truth. Don't make stuff up.
- If you don't have relevant news for what they're asking, be honest and suggest they try /news [topic] to fetch fresh stuff.
- When you reference a specific article, drop the URL naturally (like "there's a good piece on it here: [url]").
- Never say "Based on the provided articles" or "According to my context" — just talk.

If they're just saying something casual (like "hey" or "what's up"), chat back naturally and maybe mention what you've been tracking lately.`;

export async function answerQuestion(question) {
  // Search DB for matching articles
  let articles = searchArticles(question);

  // Supplement with recent articles
  if (articles.length < 8) {
    const recent = getRecentArticles(72, 30);
    const seenUrls = new Set(articles.map(a => a.url));
    for (const a of recent) {
      if (!seenUrls.has(a.url)) {
        articles.push(a);
        seenUrls.add(a.url);
      }
    }
  }

  // Sort by importance
  articles.sort((a, b) => (b.importance || 0) - (a.importance || 0));

  // Log memory
  logMemory('query', { detail: question });

  const model = getModel();
  if (model && articles.length > 0) {
    const context = buildContext(articles);
    const prompt = `${CHAT_SYSTEM_PROMPT}

---
RECENT NEWS YOU'VE BEEN TRACKING:
${context}
---

USER SAYS: ${question}`;

    try {
      const result = await model.generateContent(prompt);
      const answer = result.response.text();
      const sources = articles.slice(0, 5);
      const articleIds = sources.map(a => a.id);
      saveQuerySession(question, answer, articleIds);
      return { answer, sources };
    } catch (err) {
      console.error('Gemini Q&A error:', err.message);
    }
  }

  // If no model or no articles
  if (articles.length === 0) {
    return {
      answer: "Hmm, I don't have much stored on that yet. Run /digest to pull in today's news and I'll be able to fill you in.",
      sources: [],
    };
  }

  // Fallback to heuristic
  const fallback = heuristicAnswer(question, articles);
  saveQuerySession(question, fallback.answer, fallback.sources.map(a => a.id));
  return fallback;
}

// For handling plain freeform messages (not commands)
export async function chat(message) {
  const model = getModel();

  // Pull recent articles for context
  const recent = getRecentArticles(72, 30);
  recent.sort((a, b) => (b.importance || 0) - (a.importance || 0));

  // Also search for message-relevant articles
  let searched = searchArticles(message);
  const seenUrls = new Set(recent.map(a => a.url));
  for (const a of searched) {
    if (!seenUrls.has(a.url)) {
      recent.push(a);
      seenUrls.add(a.url);
    }
  }

  if (!model) {
    // No AI — give a simple response
    if (recent.length === 0) {
      return "Hey! I'm your news bot. I don't have recent articles loaded yet — try /digest to pull in today's stories, then chat with me about them.";
    }
    return `Hey! I've got ${recent.length} articles tracked. Try /news [topic] or /ask [question] to dig in.`;
  }

  const context = recent.length > 0 ? buildContext(recent, 3500) : 'No recent articles loaded yet.';

  const prompt = `${CHAT_SYSTEM_PROMPT}

---
RECENT NEWS YOU'VE BEEN TRACKING:
${context}
---

USER SAYS: ${message}`;

  try {
    const result = await model.generateContent(prompt);
    logMemory('chat', { detail: message });
    return result.response.text();
  } catch (err) {
    console.error('Gemini chat error:', err.message);
    return "Got your message but my AI brain is having a moment. Try again in a sec, or use /ask if you need something specific.";
  }
}
