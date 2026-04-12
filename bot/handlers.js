import {
  loadConfig, addTopic, removeTopic, addTwitterAccount, removeTwitterAccount,
  addInstagramAccount, removeInstagramAccount, addSubreddit, removeSubreddit,
  toggleSource, setDigestTime, addYoutubeChannel, removeYoutubeChannel,
  addRssFeed, removeRssFeed,
} from '../core/config.js';
import {
  upsertTopic, deactivateTopic, getAllTopics, addAlertRule, removeAlertRule,
  getAllAlertRules, getRecentArticles, getInterestProfile, getRecentQueries, logMemory,
} from '../core/db.js';
import { ingestTopic, ingestDailyDigest, ingestSocialHighlights } from '../pipeline/ingestion.js';
import { getBreakingArticles, formatAlert } from '../pipeline/alerting.js';
import { answerQuestion } from '../ai/queryEngine.js';
import { markAlertSent } from '../core/db.js';
import {
  formatDailyDigest, formatSearchResults, formatSourcesList,
  formatConfigSummary, formatArticle, splitMessage,
} from './formatter.js';
import { isPaused, setPaused, restartScheduler } from './scheduler.js';

const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function isAuthorized(msg) {
  if (!CHAT_ID) return true;
  return String(msg.chat.id) === String(CHAT_ID);
}

async function send(bot, chatId, text) {
  for (const part of splitMessage(text)) {
    try {
      await bot.sendMessage(chatId, part, { parse_mode: 'Markdown' });
    } catch {
      await bot.sendMessage(chatId, part);
    }
  }
}

// ─── Core Commands ───────────────────────────────────────────────────────────

export async function startCmd(bot, msg) {
  if (!isAuthorized(msg)) return;
  const text = `🤖 *Jarvis Intelligence Bot*\n\nWelcome! I monitor news from multiple sources and deliver AI-scored intelligence.\n\nYour Chat ID: \`${msg.chat.id}\`\n\nSend /help for all commands.`;
  await send(bot, msg.chat.id, text);
}

export async function helpCmd(bot, msg) {
  if (!isAuthorized(msg)) return;
  const text = `📖 *Jarvis Bot — Command Reference*
─────────────────────

*Core Commands:*
/digest — Get today's top stories
/news [topic] — Search any topic on demand
/ask [question] — Q&A over stored articles
/top — Top 5 stories from last 48h
/settings — Show current configuration

*Topic Management:*
/topics — List monitored topics
/addtopic [name] — Add a topic
/removetopic [name] — Remove a topic

*Alert Configuration:*
/alerts — Show alert rules
/addalert [topic] [keyword] — Add keyword alert
/removealert [topic] [keyword] — Remove keyword alert
/setalertlevel [topic] [0.0-1.0] — Set threshold

*News Feeds:*
/feeds — List all RSS feeds (built-in + yours)
/addfeed [url] — Add any RSS feed URL
/removefeed [url] — Remove a custom feed

*Social Accounts:*
/addtwitter @handle
/removetwitter @handle
/addinstagram username
/removeinstagram username
/addsubreddit r/name
/removesubreddit r/name
/addyoutube [channelId] — Add YouTube channel
/removeyoutube [channelId] — Remove YouTube channel

*Settings:*
/sources — Show source toggles
/togglesource [name] — Enable/disable source
/settime HH:MM — Set digest time (UTC)
/pause — Pause alerts
/resume — Resume alerts

*Memory:*
/memory — View your interest profile
/history — Recent Q&A queries`;
  await send(bot, msg.chat.id, text);
}

export async function digestCmd(bot, msg) {
  if (!isAuthorized(msg)) return;
  await bot.sendMessage(msg.chat.id, '⏳ Fetching daily digest... this may take 30-60 seconds.');

  try {
    const topicArticles = await ingestDailyDigest();
    const socialPosts = await ingestSocialHighlights();
    const text = formatDailyDigest(topicArticles, socialPosts);
    await send(bot, msg.chat.id, text);
  } catch (err) {
    await bot.sendMessage(msg.chat.id, `❌ Digest error: ${err.message}`);
  }
}

export async function newsCmd(bot, msg) {
  if (!isAuthorized(msg)) return;
  const topic = msg.text.replace(/^\/news\s*/i, '').trim();
  if (!topic) {
    await bot.sendMessage(msg.chat.id, 'Usage: /news [topic]\nExample: /news OpenAI');
    return;
  }

  await bot.sendMessage(msg.chat.id, `🔍 Searching for "${topic}"...`);
  try {
    const cfg = loadConfig();
    const articles = await ingestTopic(topic, cfg.search_results_count, false);
    const text = formatSearchResults(topic, articles);
    await send(bot, msg.chat.id, text);
  } catch (err) {
    await bot.sendMessage(msg.chat.id, `❌ Search error: ${err.message}`);
  }
}

export async function askCmd(bot, msg) {
  if (!isAuthorized(msg)) return;
  const question = msg.text.replace(/^\/ask\s*/i, '').trim();
  if (!question) {
    await bot.sendMessage(msg.chat.id, 'Usage: /ask [question]\nExample: /ask What happened with OpenAI?');
    return;
  }

  await bot.sendMessage(msg.chat.id, '🤔 Thinking...');
  try {
    const { answer } = await answerQuestion(question);
    await send(bot, msg.chat.id, answer);
  } catch (err) {
    await bot.sendMessage(msg.chat.id, `❌ Q&A error: ${err.message}`);
  }
}

export async function topCmd(bot, msg) {
  if (!isAuthorized(msg)) return;
  const articles = getRecentArticles(48, 5);
  if (articles.length === 0) {
    await bot.sendMessage(msg.chat.id, 'No articles in the last 48 hours. Run /digest first.');
    return;
  }

  let text = '🏆 *Top 5 Stories (Last 48h)*\n─────────────────────\n\n';
  for (let i = 0; i < articles.length; i++) {
    text += `*${i + 1}.* ${formatArticle(articles[i])}\n\n`;
  }
  await send(bot, msg.chat.id, text);
}

export async function settingsCmd(bot, msg) {
  if (!isAuthorized(msg)) return;
  const cfg = loadConfig();
  await send(bot, msg.chat.id, formatConfigSummary(cfg));
}

// ─── Topic Management ────────────────────────────────────────────────────────

export async function topicsCmd(bot, msg) {
  if (!isAuthorized(msg)) return;
  const cfg = loadConfig();
  if (cfg.topics.length === 0) {
    await bot.sendMessage(msg.chat.id, 'No topics configured. Use /addtopic [name] to add one.');
    return;
  }
  let text = '📋 *Monitored Topics:*\n\n';
  for (const t of cfg.topics) {
    text += `• ${t}\n`;
  }
  await send(bot, msg.chat.id, text);
}

export async function addTopicCmd(bot, msg) {
  if (!isAuthorized(msg)) return;
  const topic = msg.text.replace(/^\/addtopic\s*/i, '').trim();
  if (!topic) {
    await bot.sendMessage(msg.chat.id, 'Usage: /addtopic [name]\nExample: /addtopic Bitcoin');
    return;
  }
  addTopic(topic);
  upsertTopic(topic);
  await bot.sendMessage(msg.chat.id, `✅ Now monitoring: *${topic}*`);
}

export async function removeTopicCmd(bot, msg) {
  if (!isAuthorized(msg)) return;
  const topic = msg.text.replace(/^\/removetopic\s*/i, '').trim();
  if (!topic) {
    await bot.sendMessage(msg.chat.id, 'Usage: /removetopic [name]');
    return;
  }
  removeTopic(topic);
  deactivateTopic(topic);
  await bot.sendMessage(msg.chat.id, `✅ Removed topic: *${topic}*`);
}

// ─── Alert Management ────────────────────────────────────────────────────────

export async function alertsCmd(bot, msg) {
  if (!isAuthorized(msg)) return;
  const rules = getAllAlertRules();
  if (rules.length === 0) {
    await bot.sendMessage(msg.chat.id, 'No alert rules configured.\n\nUse /addalert [topic] [keyword] to add one.');
    return;
  }
  let text = '🚨 *Alert Rules:*\n\n';
  const grouped = {};
  for (const r of rules) {
    if (!grouped[r.topic]) grouped[r.topic] = [];
    grouped[r.topic].push(r.keyword);
  }
  for (const [topic, keywords] of Object.entries(grouped)) {
    text += `*${topic}:* ${keywords.join(', ')}\n`;
  }
  await send(bot, msg.chat.id, text);
}

export async function addAlertCmd(bot, msg) {
  if (!isAuthorized(msg)) return;
  const parts = msg.text.replace(/^\/addalert\s*/i, '').trim().split(/\s+/);
  if (parts.length < 2) {
    await bot.sendMessage(msg.chat.id, 'Usage: /addalert [topic] [keyword]\nExample: /addalert OpenAI gpt-5');
    return;
  }
  const keyword = parts.pop();
  const topic = parts.join(' ');
  addAlertRule(topic, keyword);
  await bot.sendMessage(msg.chat.id, `✅ Alert set: notify when "${keyword}" appears in *${topic}* news.`);
}

export async function removeAlertCmd(bot, msg) {
  if (!isAuthorized(msg)) return;
  const parts = msg.text.replace(/^\/removealert\s*/i, '').trim().split(/\s+/);
  if (parts.length < 2) {
    await bot.sendMessage(msg.chat.id, 'Usage: /removealert [topic] [keyword]');
    return;
  }
  const keyword = parts.pop();
  const topic = parts.join(' ');
  removeAlertRule(topic, keyword);
  await bot.sendMessage(msg.chat.id, `✅ Removed alert rule: "${keyword}" from *${topic}*.`);
}

export async function setAlertLevelCmd(bot, msg) {
  if (!isAuthorized(msg)) return;
  const parts = msg.text.replace(/^\/setalertlevel\s*/i, '').trim().split(/\s+/);
  if (parts.length < 2) {
    await bot.sendMessage(msg.chat.id, 'Usage: /setalertlevel [topic] [0.0-1.0]\nExample: /setalertlevel OpenAI 0.8');
    return;
  }
  const level = parseFloat(parts.pop());
  const topic = parts.join(' ');
  if (isNaN(level) || level < 0 || level > 1) {
    await bot.sendMessage(msg.chat.id, '❌ Level must be between 0.0 and 1.0.');
    return;
  }
  upsertTopic(topic, level);
  await bot.sendMessage(msg.chat.id, `✅ Alert threshold for *${topic}* set to ${level}.`);
}

// ─── Social Accounts ─────────────────────────────────────────────────────────

export async function addTwitterCmd(bot, msg) {
  if (!isAuthorized(msg)) return;
  const handle = msg.text.replace(/^\/addtwitter\s*/i, '').trim();
  if (!handle) { await bot.sendMessage(msg.chat.id, 'Usage: /addtwitter @handle'); return; }
  addTwitterAccount(handle);
  await bot.sendMessage(msg.chat.id, `✅ Now monitoring Twitter: @${handle.replace(/^@/, '')}`);
}

export async function removeTwitterCmd(bot, msg) {
  if (!isAuthorized(msg)) return;
  const handle = msg.text.replace(/^\/removetwitter\s*/i, '').trim();
  if (!handle) { await bot.sendMessage(msg.chat.id, 'Usage: /removetwitter @handle'); return; }
  removeTwitterAccount(handle);
  await bot.sendMessage(msg.chat.id, `✅ Removed Twitter: @${handle.replace(/^@/, '')}`);
}

export async function addInstagramCmd(bot, msg) {
  if (!isAuthorized(msg)) return;
  const user = msg.text.replace(/^\/addinstagram\s*/i, '').trim();
  if (!user) { await bot.sendMessage(msg.chat.id, 'Usage: /addinstagram username'); return; }
  addInstagramAccount(user);
  await bot.sendMessage(msg.chat.id, `✅ Now monitoring Instagram: @${user.replace(/^@/, '')}`);
}

export async function removeInstagramCmd(bot, msg) {
  if (!isAuthorized(msg)) return;
  const user = msg.text.replace(/^\/removeinstagram\s*/i, '').trim();
  if (!user) { await bot.sendMessage(msg.chat.id, 'Usage: /removeinstagram username'); return; }
  removeInstagramAccount(user);
  await bot.sendMessage(msg.chat.id, `✅ Removed Instagram: @${user.replace(/^@/, '')}`);
}

export async function addSubredditCmd(bot, msg) {
  if (!isAuthorized(msg)) return;
  const sub = msg.text.replace(/^\/addsubreddit\s*/i, '').trim();
  if (!sub) { await bot.sendMessage(msg.chat.id, 'Usage: /addsubreddit r/name'); return; }
  addSubreddit(sub);
  await bot.sendMessage(msg.chat.id, `✅ Now monitoring Reddit: r/${sub.replace(/^r\//, '')}`);
}

export async function removeSubredditCmd(bot, msg) {
  if (!isAuthorized(msg)) return;
  const sub = msg.text.replace(/^\/removesubreddit\s*/i, '').trim();
  if (!sub) { await bot.sendMessage(msg.chat.id, 'Usage: /removesubreddit r/name'); return; }
  removeSubreddit(sub);
  await bot.sendMessage(msg.chat.id, `✅ Removed Reddit: r/${sub.replace(/^r\//, '')}`);
}

export async function addYoutubeCmd(bot, msg) {
  if (!isAuthorized(msg)) return;
  const channelId = msg.text.replace(/^\/addyoutube\s*/i, '').trim();
  if (!channelId) {
    await bot.sendMessage(msg.chat.id, 'Usage: /addyoutube [channelId]\n\nFind the channel ID in the YouTube URL:\nyoutube.com/channel/UCxxxxxxxx\n\nExample: /addyoutube UCbmNph6atAoGfqLoCL_duAg');
    return;
  }
  addYoutubeChannel(channelId);
  await bot.sendMessage(msg.chat.id, `✅ Added YouTube channel: \`${channelId}\`\n\nUse /togglesource youtube to make sure YouTube is enabled.`);
}

export async function removeYoutubeCmd(bot, msg) {
  if (!isAuthorized(msg)) return;
  const channelId = msg.text.replace(/^\/removeyoutube\s*/i, '').trim();
  if (!channelId) { await bot.sendMessage(msg.chat.id, 'Usage: /removeyoutube [channelId]'); return; }
  removeYoutubeChannel(channelId);
  await bot.sendMessage(msg.chat.id, `✅ Removed YouTube channel: \`${channelId}\``);
}

export async function feedsCmd(bot, msg) {
  if (!isAuthorized(msg)) return;
  const { CURATED_FEEDS } = await import('../sources/webNews.js');
  const cfg = loadConfig();

  let text = '📡 *News Feed Sources*\n─────────────────────\n\n';
  text += '*Built-in feeds (always active):*\n';
  for (const f of CURATED_FEEDS) {
    text += `${f.icon} ${f.name}\n`;
  }

  const custom = cfg.custom_rss_feeds || [];
  text += `\n*Your custom feeds (${custom.length}):*\n`;
  if (custom.length === 0) {
    text += '_None yet. Use /addfeed [url] to add one._\n';
  } else {
    for (const url of custom) {
      text += `• ${url}\n`;
    }
  }
  text += '\nUse /addfeed [rss-url] to add any RSS feed.';
  await send(bot, msg.chat.id, text);
}

export async function addFeedCmd(bot, msg) {
  if (!isAuthorized(msg)) return;
  const url = msg.text.replace(/^\/addfeed\s*/i, '').trim();
  if (!url || !url.startsWith('http')) {
    await bot.sendMessage(msg.chat.id, 'Usage: /addfeed [rss-url]\nExample: /addfeed https://feeds.bbci.co.uk/news/rss.xml');
    return;
  }
  addRssFeed(url);
  await bot.sendMessage(msg.chat.id, `✅ Added RSS feed:\n\`${url}\`\n\nIt'll show up in your next /digest or /news search.`);
}

export async function removeFeedCmd(bot, msg) {
  if (!isAuthorized(msg)) return;
  const url = msg.text.replace(/^\/removefeed\s*/i, '').trim();
  if (!url) {
    await bot.sendMessage(msg.chat.id, 'Usage: /removefeed [rss-url]\nUse /feeds to see your current list.');
    return;
  }
  removeRssFeed(url);
  await bot.sendMessage(msg.chat.id, `✅ Removed RSS feed:\n\`${url}\``);
}

// ─── Settings ────────────────────────────────────────────────────────────────

export async function sourcesCmd(bot, msg) {
  if (!isAuthorized(msg)) return;
  const cfg = loadConfig();
  await send(bot, msg.chat.id, formatSourcesList(cfg));
}

export async function toggleSourceCmd(bot, msg) {
  if (!isAuthorized(msg)) return;
  const name = msg.text.replace(/^\/togglesource\s*/i, '').trim();
  if (!name) {
    await bot.sendMessage(msg.chat.id, 'Usage: /togglesource [name]\nAvailable: google_news_rss, newsapi, reddit, twitter, instagram, youtube');
    return;
  }
  const result = toggleSource(name);
  if (result === null) {
    await bot.sendMessage(msg.chat.id, `❌ Unknown source: ${name}`);
  } else {
    await bot.sendMessage(msg.chat.id, `✅ ${name} is now ${result ? 'enabled' : 'disabled'}.`);
  }
}

export async function setTimeCmd(bot, msg) {
  if (!isAuthorized(msg)) return;
  const time = msg.text.replace(/^\/settime\s*/i, '').trim();
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    await bot.sendMessage(msg.chat.id, 'Usage: /settime HH:MM (24h UTC)\nExample: /settime 09:00');
    return;
  }
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (h < 0 || h > 23 || m < 0 || m > 59) {
    await bot.sendMessage(msg.chat.id, '❌ Invalid time.');
    return;
  }
  setDigestTime(h, m);
  restartScheduler();
  await bot.sendMessage(msg.chat.id, `✅ Daily digest time set to ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} UTC.`);
}

export async function pauseCmd(bot, msg) {
  if (!isAuthorized(msg)) return;
  setPaused(true);
  await bot.sendMessage(msg.chat.id, '⏸️ Alerts and digests paused. Send /resume to restart.');
}

export async function resumeCmd(bot, msg) {
  if (!isAuthorized(msg)) return;
  setPaused(false);
  await bot.sendMessage(msg.chat.id, '▶️ Alerts and digests resumed.');
}

// ─── Memory & History ────────────────────────────────────────────────────────

export async function memoryCmd(bot, msg) {
  if (!isAuthorized(msg)) return;
  const profile = getInterestProfile();
  if (Object.keys(profile).length === 0) {
    await bot.sendMessage(msg.chat.id, '📊 No interest data yet. Use the bot more to build your profile!');
    return;
  }
  let text = '📊 *Your Interest Profile:*\n\n';
  const sorted = Object.entries(profile).sort((a, b) => b[1] - a[1]);
  const maxCount = sorted[0][1];
  for (const [topic, count] of sorted) {
    const bar = '█'.repeat(Math.ceil((count / maxCount) * 10));
    text += `${topic}: ${bar} (${count})\n`;
  }
  await send(bot, msg.chat.id, text);
}

export async function historyCmd(bot, msg) {
  if (!isAuthorized(msg)) return;
  const queries = getRecentQueries(5);
  if (queries.length === 0) {
    await bot.sendMessage(msg.chat.id, '📜 No Q&A history yet. Try /ask [question].');
    return;
  }
  let text = '📜 *Recent Q&A:*\n\n';
  for (const q of queries) {
    text += `❓ ${q.question}\n`;
    text += `_${(q.answer || '').substring(0, 100)}..._\n\n`;
  }
  await send(bot, msg.chat.id, text);
}
