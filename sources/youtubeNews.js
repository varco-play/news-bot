import Parser from 'rss-parser';

const rssParser = new Parser();

// YouTube channel RSS: no API key needed
// channelId can be found in the channel URL: youtube.com/channel/UC...
// or we search via a public scrape of the channel page

const SEARCH_CHANNELS = {
  'artificial intelligence': ['UCbmNph6atAoGfqLoCL_duAg', 'UCLB7AzTwc6VFZrBsO2ucBMg'], // TechLinked, Two Minute Papers
  'technology': ['UCXuqSBlHAE6Xw-yeJA0Tunw', 'UCVHICXXtKG7rZgtC5xonNdQ'],
  'openai': ['UCbmNph6atAoGfqLoCL_duAg'],
};

export async function fetchYoutubeChannel(channelId, maxResults = 3) {
  try {
    const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    const feed = await rssParser.parseURL(url);

    return (feed.items || []).slice(0, maxResults).map(item => ({
      title: item.title || '',
      url: item.link || '',
      summary: item.contentSnippet || item.title || '',
      source: `▶️ ${feed.title || 'YouTube'}`,
      source_type: 'youtube',
      published_at: item.isoDate || new Date().toISOString(),
      engagement: 0,
    }));
  } catch (err) {
    // silently skip unavailable channels
    return [];
  }
}

export async function fetchYoutubeSearch(query, maxResults = 3) {
  // Use predefined channel lists for known topics, fallback to a few general tech channels
  const lq = query.toLowerCase();
  let channelIds = [];

  for (const [keyword, ids] of Object.entries(SEARCH_CHANNELS)) {
    if (lq.includes(keyword)) {
      channelIds.push(...ids);
    }
  }

  // Default tech channels if no match
  if (channelIds.length === 0) {
    channelIds = [
      'UCXuqSBlHAE6Xw-yeJA0Tunw', // Linus Tech Tips
      'UCbmNph6atAoGfqLoCL_duAg', // TechLinked
    ];
  }

  // Deduplicate
  channelIds = [...new Set(channelIds)];

  const results = await Promise.all(channelIds.map(id => fetchYoutubeChannel(id, maxResults)));
  const articles = results.flat();

  // Filter by query terms
  const terms = lq.split(/\s+/).filter(t => t.length > 3);
  const relevant = terms.length > 0
    ? articles.filter(a => terms.some(t => (a.title || '').toLowerCase().includes(t)))
    : articles;

  return (relevant.length > 0 ? relevant : articles).slice(0, maxResults);
}

export async function fetchAllYoutubeChannels(channelIds, maxPerChannel = 2) {
  const results = await Promise.all(channelIds.map(id => fetchYoutubeChannel(id, maxPerChannel)));
  return results.flat();
}
