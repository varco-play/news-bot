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

function buildContext(articles, maxChars = 3000) {
  let context = '';
  for (const a of articles) {
    const entry = `[${a.source}] ${a.title}\n${a.summary || ''}\nURL: ${a.url}\nImportance: ${a.importance}\n\n`;
    if (context.length + entry.length > maxChars) break;
    context += entry;
  }
  return context;
}

function heuristicAnswer(question, articles) {
  if (!articles || articles.length === 0) {
    return { answer: "I don't have enough stored articles to answer that question. Try /digest first to fetch news, then ask again.", sources: [] };
  }

  let text = `Here's what I found recently about *${question}*:\n\n`;
  for (const a of articles.slice(0, 5)) {
    text += `• *${a.title}* (${a.source})\n`;
    text += `  _${(a.summary || '').substring(0, 120)}_\n`;
    text += `  🔗 ${a.url}\n\n`;
  }
  return { answer: text, sources: articles.slice(0, 5) };
}

export async function answerQuestion(question) {
  // Search DB for matching articles
  let articles = searchArticles(question);

  // If not enough, also get recent articles
  if (articles.length < 5) {
    const recent = getRecentArticles(72, 20);
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

  // Try AI answer
  const model = getModel();
  if (model && articles.length > 0) {
    const context = buildContext(articles);
    const prompt = `You are Jarvis, an AI news intelligence assistant. Answer the user's question using ONLY the articles provided below. Cite sources by name. If the articles don't contain relevant information, say so.

ARTICLES:
${context}

QUESTION: ${question}

Provide a concise, informative answer in 2-4 sentences.`;

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

  // Fallback to heuristic
  const fallback = heuristicAnswer(question, articles);
  saveQuerySession(question, fallback.answer, fallback.sources.map(a => a.id));
  return fallback;
}
