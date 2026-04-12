import { GoogleGenerativeAI } from '@google/generative-ai';

const BREAKING_SIGNALS = [
  'launch', 'launches', 'launched', 'release', 'released', 'announces',
  'announced', 'unveils', 'unveiled', 'acquisition', 'acquires', 'acquired',
  'ipo', 'breakthrough', 'regulation', 'ban', 'banned', 'shutdown',
  'shuts down', 'layoffs', 'fired', 'resigned', 'breaking', 'urgent',
  'gpt', 'gemini', 'claude', 'llama', 'model', 'ai safety',
  'partnership', 'investment', 'billion', 'million', 'record',
  'first ever', 'unprecedented', 'massive', 'major',
];

const NOISE_SIGNALS = [
  'weekly roundup', 'newsletter', 'sponsored', 'advertisement',
  'opinion:', 'editorial', 'podcast recap', 'listicle',
];

let _genai = null;
let _model = null;

function getModel() {
  if (_model) return _model;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  _genai = new GoogleGenerativeAI(apiKey);
  _model = _genai.getGenerativeModel({ model: 'gemini-2.0-flash' });
  return _model;
}

function heuristicImportance(article) {
  const text = `${article.title || ''} ${article.summary || ''}`.toLowerCase();

  for (const noise of NOISE_SIGNALS) {
    if (text.includes(noise)) return 0.1;
  }

  let score = 0.3;
  let signalCount = 0;
  for (const signal of BREAKING_SIGNALS) {
    if (text.includes(signal)) signalCount++;
  }
  score += Math.min(signalCount * 0.08, 0.4);

  const engagement = article.engagement || article.score || 0;
  if (engagement > 1000) score += 0.15;
  else if (engagement > 100) score += 0.08;
  else if (engagement > 10) score += 0.03;

  const wordCount = (article.title || '').split(/\s+/).length;
  if (wordCount <= 8) score += 0.05;

  return Math.min(score, 1.0);
}

async function aiScore(article) {
  const model = getModel();
  if (!model) return null;

  const prompt = `You're a witty, sharp friend who texts their crew about the latest news. Write a summary of this article in YOUR voice — casual, direct, a little hype when warranted, but always accurate. Like you're saying "bro you gotta hear this" but also keeping it real. 2-3 sentences max. No hashtags, no emojis, no "In summary:", just talk naturally.

Also rate how big of a deal this is from 0.00 to 1.00:
- 0.0-0.3: meh, routine stuff
- 0.3-0.6: interesting but not earth-shattering
- 0.6-0.8: yeah this is a real development
- 0.8-1.0: actually wild, major news

Article:
Title: ${article.title || ''}
Summary: ${article.summary || ''}
Source: ${article.source || ''}

Respond with EXACTLY this format:
SUMMARY: <your casual summary here>
SCORE: <0.00>`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    const summaryMatch = text.match(/SUMMARY:\s*(.+?)(?:\n|SCORE:)/s);
    const scoreMatch = text.match(/SCORE:\s*([\d.]+)/);

    let summary = article.summary || article.title;
    let importance = heuristicImportance(article);

    if (summaryMatch) summary = summaryMatch[1].trim();
    if (scoreMatch) {
      importance = parseFloat(scoreMatch[1]);
      importance = Math.max(0, Math.min(1, importance));
      // engagement nudge
      const engagement = article.engagement || article.score || 0;
      if (engagement > 500) importance = Math.min(importance + 0.1, 1.0);
      else if (engagement > 50) importance = Math.min(importance + 0.05, 1.0);
    }

    return { summary, importance };
  } catch (err) {
    console.error('Gemini API error:', err.message);
    return null;
  }
}

export function enrichArticle(article) {
  const a = { ...article };
  a.importance = heuristicImportance(a);
  if (!a.summary || a.summary.length < 10) {
    a.summary = a.title || '';
  }
  return a;
}

export async function enrichBatch(articles, maxAiCalls = 20) {
  // Pre-score heuristically
  let enriched = articles.map(a => {
    const copy = { ...a };
    copy.importance = heuristicImportance(copy);
    if (!copy.summary || copy.summary.length < 10) {
      copy.summary = copy.title || '';
    }
    return copy;
  });

  // Sort by heuristic score (best first)
  enriched.sort((a, b) => b.importance - a.importance);

  // Call AI on top candidates
  const model = getModel();
  if (model) {
    const toEnrich = enriched.slice(0, maxAiCalls);
    for (const article of toEnrich) {
      const result = await aiScore(article);
      if (result) {
        article.summary = result.summary;
        article.importance = result.importance;
      }
    }
    // Re-sort after AI scoring
    enriched.sort((a, b) => b.importance - a.importance);
  }

  return enriched;
}
