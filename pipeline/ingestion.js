import { loadConfig } from '../core/config.js';
import { isSeen, saveArticle, markDigestSent } from '../core/db.js';
import { enrichBatch } from '../ai/summarizer.js';
import { deduplicate } from '../ai/deduplicator.js';
import { fetchWebNews } from '../sources/webNews.js';
import { fetchRedditSearch, fetchAllSubreddits } from '../sources/redditNews.js';
import { fetchTwitterSearch, fetchAllAccounts } from '../sources/twitterNews.js';
import { fetchInstagramSearch, fetchAllInstagramAccounts } from '../sources/instagramNews.js';
import { fetchYoutubeSearch, fetchAllYoutubeChannels } from '../sources/youtubeNews.js';

export async function ingestTopic(topic, maxResults = 10, onlyNew = true) {
  const cfg = loadConfig();
  let articles = [];

  // Fetch from all active sources in parallel
  const fetchers = [];
  if (cfg.sources.google_news_rss || cfg.sources.newsapi) {
    fetchers.push(fetchWebNews(topic, 5, cfg.custom_rss_feeds || []));
  }
  if (cfg.sources.reddit) {
    fetchers.push(fetchRedditSearch(topic, cfg.reddit_subreddits, 5, cfg.reddit_min_score));
  }
  if (cfg.sources.twitter) {
    fetchers.push(fetchTwitterSearch(topic, 5));
  }
  if (cfg.sources.instagram) {
    fetchers.push(fetchInstagramSearch(topic, 3));
  }
  if (cfg.sources.youtube) {
    fetchers.push(fetchYoutubeSearch(topic, 3));
  }

  const results = await Promise.all(fetchers);
  for (const batch of results) {
    articles.push(...batch);
  }

  // URL dedup
  const seen = new Set();
  articles = articles.filter(a => {
    if (seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });

  // Filter already-seen
  if (onlyNew) {
    articles = articles.filter(a => !isSeen(a.url, a.title));
  }

  // Tag with topic
  for (const a of articles) {
    a.topic = topic;
  }

  // AI enrich
  articles = await enrichBatch(articles, 15);

  // Deduplicate
  articles = deduplicate(articles, 'best');

  // Save to DB
  for (const a of articles) {
    saveArticle(a);
  }

  // Sort by importance
  articles.sort((a, b) => (b.importance || 0) - (a.importance || 0));

  return articles.slice(0, maxResults);
}

export async function ingestDailyDigest() {
  const cfg = loadConfig();
  const result = {};
  for (const topic of cfg.topics) {
    result[topic] = await ingestTopic(topic, cfg.digest_articles_per_topic, true);
  }
  return result;
}

export async function ingestSocialHighlights() {
  const cfg = loadConfig();
  let articles = [];

  const fetchers = [];
  if (cfg.sources.twitter && cfg.twitter_accounts.length > 0) {
    fetchers.push(fetchAllAccounts(cfg.twitter_accounts, 2));
  }
  if (cfg.sources.reddit && cfg.reddit_subreddits.length > 0) {
    fetchers.push(fetchAllSubreddits(cfg.reddit_subreddits, 3));
  }
  if (cfg.sources.instagram && cfg.instagram_accounts.length > 0) {
    fetchers.push(fetchAllInstagramAccounts(cfg.instagram_accounts, 2));
  }
  if (cfg.sources.youtube && cfg.youtube_channels && cfg.youtube_channels.length > 0) {
    fetchers.push(fetchAllYoutubeChannels(cfg.youtube_channels, 2));
  }

  const results = await Promise.all(fetchers);
  for (const batch of results) {
    articles.push(...batch);
  }

  // URL dedup
  const seen = new Set();
  articles = articles.filter(a => {
    if (seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });

  // Filter already-seen
  articles = articles.filter(a => !isSeen(a.url, a.title));

  // AI enrich
  articles = await enrichBatch(articles, 10);

  // Save
  for (const a of articles) {
    saveArticle(a);
  }

  articles.sort((a, b) => (b.importance || 0) - (a.importance || 0));
  return articles;
}
