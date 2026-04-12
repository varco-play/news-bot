// Reddit API using native fetch — no snoowrap dependency needed
// Uses Reddit's public JSON API (no auth required for public posts)
// For authenticated access, set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET

let _tokenCache = null;
let _tokenExpiry = 0;

async function getAccessToken() {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  // Return cached token if still valid
  if (_tokenCache && Date.now() < _tokenExpiry) return _tokenCache;

  try {
    const userAgent = process.env.REDDIT_USER_AGENT || 'jarvis-news-bot/1.0';
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const resp = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'User-Agent': userAgent,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const data = await resp.json();
    if (data.access_token) {
      _tokenCache = data.access_token;
      _tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
      return _tokenCache;
    }
  } catch (err) {
    console.error('Reddit auth error:', err.message);
  }
  return null;
}

async function redditGet(url) {
  const userAgent = process.env.REDDIT_USER_AGENT || 'jarvis-news-bot/1.0';
  const token = await getAccessToken();

  const headers = { 'User-Agent': userAgent };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const apiUrl = token
    ? url.replace('https://www.reddit.com', 'https://oauth.reddit.com')
    : url;

  const resp = await fetch(apiUrl, { headers });
  if (!resp.ok) throw new Error(`Reddit API ${resp.status}: ${resp.statusText}`);
  return resp.json();
}

function mapPost(post, subreddit) {
  const d = post.data || post;
  return {
    title: d.title || '',
    url: d.url || `https://reddit.com${d.permalink}`,
    summary: (d.selftext || '').substring(0, 250) || d.title || '',
    source: `📣 Reddit r/${d.subreddit || subreddit}`,
    source_type: 'reddit',
    published_at: new Date((d.created_utc || 0) * 1000).toISOString(),
    engagement: d.score || 0,
  };
}

export async function fetchSubredditHot(subreddit, limit = 10, minScore = 50) {
  try {
    const data = await redditGet(`https://www.reddit.com/r/${subreddit}/hot.json?limit=${limit}`);
    const posts = (data?.data?.children || []);
    return posts
      .map(p => mapPost(p.data, subreddit))
      .filter(p => p.engagement >= minScore);
  } catch (err) {
    console.error(`Reddit r/${subreddit} error:`, err.message);
    return [];
  }
}

export async function fetchRedditSearch(query, subreddits = [], limit = 5, minScore = 10) {
  const articles = [];
  const subsToSearch = subreddits.length > 0 ? subreddits : ['all'];

  for (const sub of subsToSearch) {
    try {
      const encoded = encodeURIComponent(query);
      const data = await redditGet(
        `https://www.reddit.com/r/${sub}/search.json?q=${encoded}&sort=relevance&t=week&limit=${limit}&restrict_sr=1`
      );
      const posts = (data?.data?.children || []);
      for (const p of posts) {
        const article = mapPost(p.data, sub);
        if (article.engagement >= minScore) articles.push(article);
      }
    } catch (err) {
      console.error(`Reddit search r/${sub} error:`, err.message);
    }
  }
  return articles;
}

export async function fetchAllSubreddits(subreddits, limitPerSub = 3) {
  const articles = [];
  for (const sub of subreddits) {
    const posts = await fetchSubredditHot(sub, limitPerSub * 2, 10);
    articles.push(...posts.slice(0, limitPerSub));
  }
  return articles;
}
