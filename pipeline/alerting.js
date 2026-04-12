import { loadConfig } from '../core/config.js';
import { getUnsentAlerts, getAlertRules, getRecentArticles } from '../core/db.js';

export function getBreakingArticles() {
  const cfg = loadConfig();
  const threshold = cfg.alert_threshold || 0.75;

  // Get high-importance unsent articles
  const highImportance = getUnsentAlerts(threshold);

  // Get articles matching keyword rules
  const keywordMatches = [];
  for (const topic of cfg.topics) {
    const rules = getAlertRules(topic);
    if (rules.length === 0) continue;

    // Get recent articles for this topic (last 1 hour)
    const recent = getRecentArticles(1, 50);
    for (const article of recent) {
      if (article.sent_alert) continue;
      const text = `${article.title} ${article.summary}`.toLowerCase();
      for (const keyword of rules) {
        if (text.includes(keyword.toLowerCase())) {
          article._keyword = keyword;
          keywordMatches.push(article);
          break;
        }
      }
    }
  }

  // Merge and dedup by id
  const seen = new Set();
  const result = [];
  for (const a of [...highImportance, ...keywordMatches]) {
    if (!seen.has(a.id)) {
      seen.add(a.id);
      result.push(a);
    }
  }

  return result;
}

export function formatAlert(article) {
  const importance = article.importance || 0;
  let emoji, label;

  if (article._keyword) {
    emoji = '🔔';
    label = `KEYWORD ALERT: "${article._keyword}"`;
  } else if (importance >= 0.9) {
    emoji = '🚨';
    label = 'BREAKING';
  } else if (importance >= 0.75) {
    emoji = '⚡';
    label = 'IMPORTANT';
  } else {
    emoji = '🔔';
    label = 'ALERT';
  }

  const pct = Math.round(importance * 100);
  let text = `${emoji} *${label}*\n\n`;
  text += `*${article.title}*\n`;
  if (article.summary && article.summary !== article.title) {
    text += `_${article.summary.substring(0, 200)}_\n`;
  }
  text += `\n📊 Importance: ${pct}%`;
  text += `\n📰 Source: ${article.source}`;
  text += `\n🔗 ${article.url}`;

  return text;
}
