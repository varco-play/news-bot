import Parser from 'rss-parser';

const rssParser = new Parser({ timeout: 10000 });

// ─── Built-in curated RSS feeds ───────────────────────────────────────────────
// These are always available, no API key needed.
// Category tags are used to match against topic searches.

export const CURATED_FEEDS = [
  // BBC
  { name: 'BBC World News',    url: 'https://feeds.bbci.co.uk/news/world/rss.xml',                   icon: '🇬🇧', categories: ['world', 'politics', 'international'] },
  { name: 'BBC Technology',    url: 'https://feeds.bbci.co.uk/news/technology/rss.xml',              icon: '🇬🇧', categories: ['technology', 'ai', 'science', 'tech'] },
  { name: 'BBC Business',      url: 'https://feeds.bbci.co.uk/news/business/rss.xml',                icon: '🇬🇧', categories: ['business', 'economy', 'finance', 'markets'] },
  { name: 'BBC Science',       url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', icon: '🇬🇧', categories: ['science', 'environment', 'space', 'climate'] },
  { name: 'BBC Health',        url: 'https://feeds.bbci.co.uk/news/health/rss.xml',                  icon: '🇬🇧', categories: ['health', 'medicine', 'covid', 'wellness'] },
  { name: 'BBC Politics',      url: 'https://feeds.bbci.co.uk/news/politics/rss.xml',               icon: '🇬🇧', categories: ['politics', 'government', 'uk', 'policy'] },
  { name: 'BBC Top Stories',   url: 'https://feeds.bbci.co.uk/news/rss.xml',                        icon: '🇬🇧', categories: ['general', 'top', 'breaking', 'news'] },

  // MIT Technology Review
  { name: 'MIT Tech Review',   url: 'https://www.technologyreview.com/feed/',                        icon: '🎓', categories: ['technology', 'ai', 'science', 'innovation', 'research'] },

  // Reuters via Google News (since feeds.reuters.com is offline)
  { name: 'Reuters',           url: 'https://news.google.com/rss/search?q=site:reuters.com+when:1d&hl=en-US&gl=US&ceid=US:en', icon: '📡', categories: ['world', 'politics', 'finance', 'business', 'general', 'top', 'breaking'] },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function parseFeed(feed, maxResults) {
  try {
    const parsed = await rssParser.parseURL(feed.url);
    return (parsed.items || []).slice(0, maxResults).map(item => {
      let title = item.title || '';
      // Google News titles include " - SourceName" at end — strip it for Reuters proxy
      const dashIdx = title.lastIndexOf(' - ');
      if (dashIdx > 0 && feed.name === 'Reuters') {
        title = title.substring(0, dashIdx).trim();
      }
      return {
        title,
        url: item.link || '',
        summary: item.contentSnippet || item.summary || title,
        source: `${feed.icon} ${feed.name}`,
        source_type: 'web',
        published_at: item.isoDate || new Date().toISOString(),
      };
    });
  } catch {
    return [];
  }
}

function feedMatchesTopic(feed, topic) {
  const lq = topic.toLowerCase();
  // Check if any category keyword appears in the query, or query appears in categories
  for (const cat of feed.categories) {
    if (lq.includes(cat) || cat.includes(lq.split(/\s+/)[0])) return true;
  }
  return false;
}

// ─── Main fetchers ────────────────────────────────────────────────────────────

export async function fetchGoogleNews(query, maxResults = 5) {
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`;
    const feed = await rssParser.parseURL(url);
    const articles = [];

    for (const item of (feed.items || []).slice(0, maxResults)) {
      let title = item.title || '';
      let source = 'Google News';
      const dashIdx = title.lastIndexOf(' - ');
      if (dashIdx > 0) {
        source = title.substring(dashIdx + 3).trim();
        title = title.substring(0, dashIdx).trim();
      }
      articles.push({
        title,
        url: item.link || '',
        summary: item.contentSnippet || title,
        source: `🌐 ${source}`,
        source_type: 'web',
        published_at: item.isoDate || new Date().toISOString(),
      });
    }
    return articles;
  } catch (err) {
    console.error('Google News RSS error:', err.message);
    return [];
  }
}

export async function fetchNewsApi(query, maxResults = 5) {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) return [];

  try {
    const encoded = encodeURIComponent(query);
    const url = `https://newsapi.org/v2/everything?q=${encoded}&language=en&sortBy=publishedAt&pageSize=${maxResults}&apiKey=${apiKey}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.status !== 'ok' || !data.articles) return [];

    return data.articles.map(a => ({
      title: a.title || '',
      url: a.url || '',
      summary: a.description || a.title || '',
      source: `📰 ${(a.source && a.source.name) || 'NewsAPI'}`,
      source_type: 'web',
      published_at: a.publishedAt || new Date().toISOString(),
    }));
  } catch (err) {
    console.error('NewsAPI error:', err.message);
    return [];
  }
}

// Fetch from curated feeds that match the topic, plus any user-added custom feeds
export async function fetchCuratedFeeds(query, customFeedUrls = [], maxPerFeed = 3) {
  // Pick built-in feeds that match this topic, always include BBC Top + Reuters as fallback
  const matched = CURATED_FEEDS.filter(f =>
    feedMatchesTopic(f, query) ||
    f.categories.includes('general') ||
    f.categories.includes('top')
  );

  // User custom feeds (just URLs — treat as general)
  const customFeeds = customFeedUrls.map(url => ({
    name: extractFeedName(url),
    url,
    icon: '📰',
    categories: ['general'],
  }));

  const allFeeds = [...matched, ...customFeeds];
  if (allFeeds.length === 0) return [];

  const results = await Promise.all(allFeeds.map(f => parseFeed(f, maxPerFeed)));
  return results.flat();
}

// Fetch ALL curated feeds (for daily digest / social highlights)
export async function fetchAllCuratedFeeds(customFeedUrls = [], maxPerFeed = 3) {
  const customFeeds = customFeedUrls.map(url => ({
    name: extractFeedName(url),
    url,
    icon: '📰',
    categories: ['general'],
  }));

  const allFeeds = [...CURATED_FEEDS, ...customFeeds];
  const results = await Promise.all(allFeeds.map(f => parseFeed(f, maxPerFeed)));
  return results.flat();
}

function extractFeedName(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    return h.split('.')[0].charAt(0).toUpperCase() + h.split('.')[0].slice(1);
  } catch {
    return 'Custom Feed';
  }
}

// Main entry point used by ingestion pipeline
export async function fetchWebNews(query, maxResults = 5, customFeedUrls = []) {
  const [google, newsapi, curated] = await Promise.all([
    fetchGoogleNews(query, maxResults),
    fetchNewsApi(query, maxResults),
    fetchCuratedFeeds(query, customFeedUrls, 3),
  ]);

  // URL dedup, merged
  const seen = new Set();
  const merged = [];
  for (const a of [...curated, ...google, ...newsapi]) {
    if (a.url && !seen.has(a.url)) {
      seen.add(a.url);
      merged.push(a);
    }
  }
  return merged.slice(0, maxResults * 3);
}
