function shorten(text, maxLen = 280) {
  if (!text || text.length <= maxLen) return text || '';
  return text.substring(0, maxLen - 3) + '...';
}

function importanceLabel(score) {
  if (score >= 0.85) return '🔥 Big deal';
  if (score >= 0.70) return '⚡ Worth knowing';
  if (score >= 0.50) return '👀 Interesting';
  return '💬 FYI';
}

function sourceIcon(sourceType) {
  const icons = {
    reddit: '🔴 Reddit',
    twitter: '🐦 Twitter/X',
    instagram: '📸 Instagram',
    youtube: '▶️ YouTube',
    web: '🌐 Web',
  };
  return icons[sourceType] || '📰 News';
}

export function formatArticle(article) {
  const title = article.title || 'Untitled';
  const summary = shorten(article.summary || '', 280);
  const pct = Math.round((article.importance || 0) * 100);
  const label = importanceLabel(article.importance || 0);
  const srcType = sourceIcon(article.source_type || 'web');
  // Use original source name if available, else fall back to type icon
  const srcName = article.source ? article.source.replace(/^[🌐📰🔴🐦📸▶️]\s*/, '') : srcType;

  let text = `${label} — *${title}*\n`;
  if (summary && summary !== title) {
    text += `_${summary}_\n`;
  }
  text += `\n📡 ${srcName} · ${pct}% relevance\n`;
  text += `🔗 ${article.url || ''}`;
  return text;
}

export function formatTopicSection(topic, articles) {
  if (!articles || articles.length === 0) {
    return `━━━ ${topic} ━━━\n_Nothing new popped up here yet._\n`;
  }

  let text = `━━━ *${topic}* ━━━\n\n`;
  for (const a of articles) {
    text += formatArticle(a) + '\n\n';
  }
  return text;
}

export function formatDailyDigest(topicArticles, socialPosts = []) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  let text = `🗞 *What's going on — ${dateStr}*\n─────────────────────\n\n`;

  for (const [topic, articles] of Object.entries(topicArticles)) {
    text += formatTopicSection(topic, articles) + '\n';
  }

  if (socialPosts && socialPosts.length > 0) {
    text += '━━━ 📲 *Trending on Socials* ━━━\n\n';
    for (const post of socialPosts.slice(0, 5)) {
      text += formatArticle(post) + '\n\n';
    }
  }

  text += '_Hit /news [topic] to dig into anything specific._';
  return text;
}

export function formatSearchResults(topic, articles) {
  if (!articles || articles.length === 0) {
    return `🔍 Couldn't find anything fresh on *${topic}*.\n\nMaybe try different keywords, or check /topics to see what's being tracked.`;
  }

  let text = `🔍 *Here's what's out there on "${topic}"*\n─────────────────────\n\n`;
  for (const a of articles) {
    text += formatArticle(a) + '\n\n';
  }
  return text;
}

export function formatSourcesList(config) {
  let text = '📡 *News Sources*\n─────────────────────\n\n';
  for (const [name, enabled] of Object.entries(config.sources)) {
    const icon = enabled ? '✅' : '❌';
    text += `${icon} ${name}\n`;
  }
  text += '\n_Use /togglesource [name] to enable/disable._';
  return text;
}

export function formatConfigSummary(config) {
  const srcStatus = (name) => config.sources[name] ? '✅' : '❌';
  let text = '⚙️ *Settings*\n─────────────────────\n\n';
  text += `📋 *Topics:* ${config.topics.join(', ') || 'None'}\n\n`;
  text += `*Sources:*\n`;
  text += `${srcStatus('google_news_rss')} Google News RSS\n`;
  text += `${srcStatus('reddit')} Reddit (${config.reddit_subreddits.map(s => 'r/' + s).join(', ') || 'none set'})\n`;
  text += `${srcStatus('youtube')} YouTube ${config.youtube_channels && config.youtube_channels.length ? `(${config.youtube_channels.length} channels)` : '(built-in tech channels)'}\n`;
  text += `${srcStatus('twitter')} Twitter/X ${process.env.TWITTER_BEARER_TOKEN ? '🔑' : '(no API key)'}\n`;
  text += `${srcStatus('instagram')} Instagram ${process.env.APIFY_API_TOKEN ? '🔑' : '(no API key)'}\n`;
  text += `${srcStatus('newsapi')} NewsAPI ${process.env.NEWS_API_KEY ? '🔑' : '(no API key)'}\n`;
  const customFeeds = config.custom_rss_feeds || [];
  text += `📰 Custom RSS feeds: ${customFeeds.length > 0 ? customFeeds.length + ' added' : 'none (use /addfeed)'}\n\n`;
  text += `⏰ *Digest:* ${String(config.digest_hour).padStart(2, '0')}:${String(config.digest_minute).padStart(2, '0')} UTC\n`;
  text += `🚨 *Alert threshold:* ${config.alert_threshold}\n`;
  text += `⏱️ *Alert polling:* every ${config.alert_poll_interval_minutes}min\n`;
  return text;
}

export function splitMessage(text, maxLen = 4000) {
  if (text.length <= maxLen) return [text];
  const parts = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      parts.push(remaining);
      break;
    }
    let splitIdx = remaining.lastIndexOf('\n', maxLen);
    if (splitIdx <= 0) splitIdx = maxLen;
    parts.push(remaining.substring(0, splitIdx));
    remaining = remaining.substring(splitIdx);
  }
  return parts;
}
