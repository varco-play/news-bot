const APIFY_BASE = 'https://api.apify.com/v2';

function getToken() {
  return process.env.APIFY_API_TOKEN || null;
}

export async function fetchInstagramProfile(username, maxPosts = 5) {
  const token = getToken();
  if (!token) return [];

  try {
    const resp = await fetch(`${APIFY_BASE}/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        directUrls: [`https://www.instagram.com/${username}/`],
        resultsLimit: maxPosts,
        resultsType: 'posts',
      }),
    });
    const data = await resp.json();
    if (!Array.isArray(data)) return [];

    return data.slice(0, maxPosts).map(post => ({
      title: `@${username}: ${(post.caption || '').substring(0, 100)}`,
      url: post.url || `https://www.instagram.com/p/${post.shortCode}/`,
      summary: post.caption || '',
      source: `📸 Instagram @${username}`,
      source_type: 'instagram',
      published_at: post.timestamp || new Date().toISOString(),
      engagement: (post.likesCount || 0) + (post.commentsCount || 0),
    }));
  } catch (err) {
    console.error(`Instagram @${username} error:`, err.message);
    return [];
  }
}

export async function fetchInstagramHashtag(hashtag, maxPosts = 5) {
  const token = getToken();
  if (!token) return [];

  try {
    const tag = hashtag.replace(/^#/, '');
    const resp = await fetch(`${APIFY_BASE}/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        directUrls: [`https://www.instagram.com/explore/tags/${tag}/`],
        resultsLimit: maxPosts,
        resultsType: 'posts',
      }),
    });
    const data = await resp.json();
    if (!Array.isArray(data)) return [];

    return data.slice(0, maxPosts).map(post => ({
      title: `#${tag}: ${(post.caption || '').substring(0, 100)}`,
      url: post.url || `https://www.instagram.com/p/${post.shortCode}/`,
      summary: post.caption || '',
      source: `📸 Instagram #${tag}`,
      source_type: 'instagram',
      published_at: post.timestamp || new Date().toISOString(),
      engagement: (post.likesCount || 0) + (post.commentsCount || 0),
    }));
  } catch (err) {
    console.error(`Instagram #${hashtag} error:`, err.message);
    return [];
  }
}

export async function fetchAllInstagramAccounts(accounts, maxPerAccount = 2) {
  const articles = [];
  for (const user of accounts) {
    const posts = await fetchInstagramProfile(user.replace(/^@/, ''), maxPerAccount * 2);
    articles.push(...posts.slice(0, maxPerAccount));
  }
  return articles;
}

export async function fetchInstagramSearch(query, maxResults = 3) {
  return fetchInstagramHashtag(query.replace(/\s+/g, ''), maxResults);
}
