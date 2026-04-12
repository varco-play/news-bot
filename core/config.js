import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

const DEFAULT_CONFIG = {
  topics: ['Artificial Intelligence', 'OpenAI', 'Tesla'],
  sources: {
    google_news_rss: true,
    newsapi: true,
    reddit: true,
    twitter: false,
    instagram: false,
    youtube: true,
  },
  twitter_accounts: [],
  instagram_accounts: [],
  youtube_channels: [], // Channel IDs like UCbmNph6atAoGfqLoCL_duAg
  custom_rss_feeds: [], // User-added RSS feed URLs
  reddit_subreddits: ['technology', 'MachineLearning'],
  reddit_min_score: 50,
  digest_articles_per_topic: 3,
  search_results_count: 5,
  alert_poll_interval_minutes: 30,
  alert_threshold: 0.75,
  digest_hour: 8,
  digest_minute: 0,
};

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
        target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

export function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      return deepMerge(DEFAULT_CONFIG, data);
    }
  } catch {
    // ignore parse errors
  }
  return { ...DEFAULT_CONFIG };
}

export function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

export function addTopic(topic) {
  const cfg = loadConfig();
  if (!cfg.topics.includes(topic)) {
    cfg.topics.push(topic);
    saveConfig(cfg);
  }
  return cfg;
}

export function removeTopic(topic) {
  const cfg = loadConfig();
  cfg.topics = cfg.topics.filter(t => t !== topic);
  saveConfig(cfg);
  return cfg;
}

export function addTwitterAccount(handle) {
  const cfg = loadConfig();
  const h = handle.replace(/^@/, '');
  if (!cfg.twitter_accounts.includes(h)) {
    cfg.twitter_accounts.push(h);
    saveConfig(cfg);
  }
  return cfg;
}

export function removeTwitterAccount(handle) {
  const cfg = loadConfig();
  const h = handle.replace(/^@/, '');
  cfg.twitter_accounts = cfg.twitter_accounts.filter(a => a !== h);
  saveConfig(cfg);
  return cfg;
}

export function addInstagramAccount(username) {
  const cfg = loadConfig();
  const u = username.replace(/^@/, '');
  if (!cfg.instagram_accounts.includes(u)) {
    cfg.instagram_accounts.push(u);
    saveConfig(cfg);
  }
  return cfg;
}

export function removeInstagramAccount(username) {
  const cfg = loadConfig();
  const u = username.replace(/^@/, '');
  cfg.instagram_accounts = cfg.instagram_accounts.filter(a => a !== u);
  saveConfig(cfg);
  return cfg;
}

export function addSubreddit(name) {
  const cfg = loadConfig();
  const sub = name.replace(/^r\//, '');
  if (!cfg.reddit_subreddits.includes(sub)) {
    cfg.reddit_subreddits.push(sub);
    saveConfig(cfg);
  }
  return cfg;
}

export function removeSubreddit(name) {
  const cfg = loadConfig();
  const sub = name.replace(/^r\//, '');
  cfg.reddit_subreddits = cfg.reddit_subreddits.filter(s => s !== sub);
  saveConfig(cfg);
  return cfg;
}

export function toggleSource(sourceName) {
  const cfg = loadConfig();
  if (sourceName in cfg.sources) {
    cfg.sources[sourceName] = !cfg.sources[sourceName];
    saveConfig(cfg);
    return cfg.sources[sourceName];
  }
  return null;
}

export function setDigestTime(hour, minute) {
  const cfg = loadConfig();
  cfg.digest_hour = hour;
  cfg.digest_minute = minute;
  saveConfig(cfg);
  return cfg;
}

export function addRssFeed(url) {
  const cfg = loadConfig();
  if (!cfg.custom_rss_feeds) cfg.custom_rss_feeds = [];
  const u = url.trim();
  if (!cfg.custom_rss_feeds.includes(u)) {
    cfg.custom_rss_feeds.push(u);
    saveConfig(cfg);
  }
  return cfg;
}

export function removeRssFeed(url) {
  const cfg = loadConfig();
  if (!cfg.custom_rss_feeds) cfg.custom_rss_feeds = [];
  cfg.custom_rss_feeds = cfg.custom_rss_feeds.filter(f => f !== url.trim());
  saveConfig(cfg);
  return cfg;
}

export function addYoutubeChannel(channelId) {
  const cfg = loadConfig();
  if (!cfg.youtube_channels) cfg.youtube_channels = [];
  const id = channelId.trim();
  if (!cfg.youtube_channels.includes(id)) {
    cfg.youtube_channels.push(id);
    saveConfig(cfg);
  }
  return cfg;
}

export function removeYoutubeChannel(channelId) {
  const cfg = loadConfig();
  if (!cfg.youtube_channels) cfg.youtube_channels = [];
  cfg.youtube_channels = cfg.youtube_channels.filter(c => c !== channelId.trim());
  saveConfig(cfg);
  return cfg;
}
