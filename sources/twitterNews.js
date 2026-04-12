const TWITTER_API = 'https://api.twitter.com/2';

function headers() {
  const token = process.env.TWITTER_BEARER_TOKEN;
  if (!token) return null;
  return { Authorization: `Bearer ${token}` };
}

export async function fetchUserTimeline(username, maxResults = 5) {
  const h = headers();
  if (!h) return [];

  try {
    // Look up user ID
    const userResp = await fetch(`${TWITTER_API}/users/by/username/${username}`, { headers: h });
    const userData = await userResp.json();
    if (!userData.data) return [];
    const userId = userData.data.id;

    // Fetch tweets
    const tweetsResp = await fetch(
      `${TWITTER_API}/users/${userId}/tweets?max_results=${Math.min(maxResults, 100)}&exclude=retweets,replies&tweet.fields=created_at,public_metrics`,
      { headers: h }
    );
    const tweetsData = await tweetsResp.json();
    if (!tweetsData.data) return [];

    return tweetsData.data.map(t => {
      const metrics = t.public_metrics || {};
      const engagement = (metrics.like_count || 0) + (metrics.retweet_count || 0);
      return {
        title: `@${username}: ${(t.text || '').substring(0, 100)}`,
        url: `https://twitter.com/${username}/status/${t.id}`,
        summary: t.text || '',
        source: `🐦 Twitter @${username}`,
        source_type: 'twitter',
        published_at: t.created_at || new Date().toISOString(),
        engagement,
      };
    });
  } catch (err) {
    console.error(`Twitter @${username} error:`, err.message);
    return [];
  }
}

export async function fetchTwitterSearch(query, maxResults = 5) {
  const h = headers();
  if (!h) return [];

  try {
    const encoded = encodeURIComponent(`${query} lang:en -is:retweet`);
    const resp = await fetch(
      `${TWITTER_API}/tweets/search/recent?query=${encoded}&max_results=${Math.min(maxResults, 100)}&tweet.fields=created_at,public_metrics,author_id&expansions=author_id&user.fields=username`,
      { headers: h }
    );
    const data = await resp.json();
    if (!data.data) return [];

    // Build author map
    const authors = {};
    if (data.includes && data.includes.users) {
      for (const u of data.includes.users) {
        authors[u.id] = u.username;
      }
    }

    return data.data.map(t => {
      const username = authors[t.author_id] || 'unknown';
      const metrics = t.public_metrics || {};
      const engagement = (metrics.like_count || 0) + (metrics.retweet_count || 0);
      return {
        title: `@${username}: ${(t.text || '').substring(0, 100)}`,
        url: `https://twitter.com/${username}/status/${t.id}`,
        summary: t.text || '',
        source: `🐦 Twitter @${username}`,
        source_type: 'twitter',
        published_at: t.created_at || new Date().toISOString(),
        engagement,
      };
    });
  } catch (err) {
    console.error('Twitter search error:', err.message);
    return [];
  }
}

export async function fetchAllAccounts(accounts, maxPerAccount = 2) {
  const articles = [];
  for (const handle of accounts) {
    const tweets = await fetchUserTimeline(handle.replace(/^@/, ''), maxPerAccount * 2);
    articles.push(...tweets.slice(0, maxPerAccount));
  }
  return articles;
}
