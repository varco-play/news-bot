import {
  loadConfig, addTopic, removeTopic, addTwitterAccount, removeTwitterAccount,
  addInstagramAccount, removeInstagramAccount, addSubreddit, removeSubreddit,
  toggleSource, setDigestTime, addYoutubeChannel, removeYoutubeChannel,
  addRssFeed, removeRssFeed, registerChat, unregisterChat,
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

// ─── Auth model ──────────────────────────────────────────────────────────────
// TELEGRAM_ADMIN_IDS = comma-separated list of user IDs who can change settings.
// Falls back to TELEGRAM_CHAT_ID for backwards compatibility.
// If neither is set, the first person to /start becomes admin automatically.
// Everyone else can use read-only commands (/news, /digest, /top, /ask, /help).

const ADMIN_IDS = new Set(
  (process.env.TELEGRAM_ADMIN_IDS || process.env.TELEGRAM_CHAT_ID || '')
    .split(',').map(s => s.trim()).filter(Boolean)
);

// Chats that receive scheduled digests/alerts (persisted in config)
export function getRegisteredChats() {
  const cfg = loadConfig();
  return cfg.registered_chats || [];
}

function isAdmin(msg) {
  // If no admins configured at all, allow anyone (open mode)
  if (ADMIN_IDS.size === 0) return true;
  return ADMIN_IDS.has(String(msg.from?.id)) || ADMIN_IDS.has(String(msg.chat?.id));
}

function isGroup(msg) {
  return msg.chat?.type === 'group' || msg.chat?.type === 'supergroup';
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

function adminOnly(bot, msg) {
  if (!isAdmin(msg)) {
    bot.sendMessage(msg.chat.id, '🔒 This command is admin-only. Ask the bot owner to add you.');
    return false;
  }
  return true;
}

// ─── Core Commands ───────────────────────────────────────────────────────────

export async function startCmd(bot, msg) {
  const adminNote = isAdmin(msg)
    ? `\n\n🔑 *You are an admin.* You can change settings and manage the bot.`
    : `\n\n👤 You have read-only access. Admins can change settings.`;

  const groupNote = isGroup(msg)
    ? `\n\n📌 *Group tip:* Use /register to get daily digests delivered here. Commands work as /cmd or /cmd@${(await bot.getMe()).username}.`
    : '';

  const text = `🤖 *Jarvis Intelligence Bot*

Hey! I track news from BBC, Reuters, Reddit, YouTube and more — then summarize it in plain English.

📋 Your chat ID: \`${msg.chat.id}\`
👤 Your user ID: \`${msg.from?.id}\`${adminNote}${groupNote}

Send /help to see all commands.`;
  await send(bot, msg.chat.id, text);
}

export async function helpCmd(bot, msg) {
  const adminCmds = isAdmin(msg) ? `
*⚙️ Admin — Topics:*
/addtopic [name] — Track a new topic
/removetopic [name] — Stop tracking a topic

*⚙️ Admin — Alerts:*
/addalert [topic] [keyword] — Keyword alert
/removealert [topic] [keyword]
/setalertlevel [topic] [0.0–1.0]

*⚙️ Admin — Feeds & Sources:*
/feeds — All RSS feeds
/addfeed [url] — Add RSS feed
/removefeed [url] — Remove RSS feed
/sources — Toggle sources on/off
/togglesource [name]
/addsubreddit r/name
/removesubreddit r/name
/addyoutube [channelId]
/removeyoutube [channelId]
/addtwitter @handle
/removetwitter @handle

*⚙️ Admin — Settings:*
/settings — Full config
/settime HH:MM — Digest time (UTC)
/pause — Pause alerts
/resume — Resume alerts` : `\n_ℹ️ Admin commands hidden. Ask the bot owner for access._`;

  const text = `📖 *Jarvis Bot — Commands*
─────────────────────

*Anyone can use:*
/digest — Today's top stories
/news [topic] — Search any topic
/ask [question] — Q&A on stored articles
/top — Top 5 from last 48h
/topics — What's being tracked
/alerts — Active alert rules
/register — Get digests in this chat
/unregister — Stop digests here
/memory — Your interest profile
/history — Recent Q&A
${adminCmds}`;
  await send(bot, msg.chat.id, text);
}

export async function digestCmd(bot, msg) {
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
  const topic = msg.text.replace(/^\/news(?:@\S+)?\s*/i, '').trim();
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
  const question = msg.text.replace(/^\/ask(?:@\S+)?\s*/i, '').trim();
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
  if (!adminOnly(bot, msg)) return;
  const cfg = loadConfig();
  await send(bot, msg.chat.id, formatConfigSummary(cfg));
}

// ─── Topic Management ────────────────────────────────────────────────────────

export async function topicsCmd(bot, msg) {
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
  if (!adminOnly(bot, msg)) return;
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
  if (!adminOnly(bot, msg)) return;
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
  if (!adminOnly(bot, msg)) return;
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
  if (!adminOnly(bot, msg)) return;
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
  if (!adminOnly(bot, msg)) return;
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
  if (!adminOnly(bot, msg)) return;
  const handle = msg.text.replace(/^\/addtwitter\s*/i, '').trim();
  if (!handle) { await bot.sendMessage(msg.chat.id, 'Usage: /addtwitter @handle'); return; }
  addTwitterAccount(handle);
  await bot.sendMessage(msg.chat.id, `✅ Now monitoring Twitter: @${handle.replace(/^@/, '')}`);
}

export async function removeTwitterCmd(bot, msg) {
  if (!adminOnly(bot, msg)) return;
  const handle = msg.text.replace(/^\/removetwitter\s*/i, '').trim();
  if (!handle) { await bot.sendMessage(msg.chat.id, 'Usage: /removetwitter @handle'); return; }
  removeTwitterAccount(handle);
  await bot.sendMessage(msg.chat.id, `✅ Removed Twitter: @${handle.replace(/^@/, '')}`);
}

export async function addInstagramCmd(bot, msg) {
  if (!adminOnly(bot, msg)) return;
  const user = msg.text.replace(/^\/addinstagram\s*/i, '').trim();
  if (!user) { await bot.sendMessage(msg.chat.id, 'Usage: /addinstagram username'); return; }
  addInstagramAccount(user);
  await bot.sendMessage(msg.chat.id, `✅ Now monitoring Instagram: @${user.replace(/^@/, '')}`);
}

export async function removeInstagramCmd(bot, msg) {
  if (!adminOnly(bot, msg)) return;
  const user = msg.text.replace(/^\/removeinstagram\s*/i, '').trim();
  if (!user) { await bot.sendMessage(msg.chat.id, 'Usage: /removeinstagram username'); return; }
  removeInstagramAccount(user);
  await bot.sendMessage(msg.chat.id, `✅ Removed Instagram: @${user.replace(/^@/, '')}`);
}

export async function addSubredditCmd(bot, msg) {
  if (!adminOnly(bot, msg)) return;
  const sub = msg.text.replace(/^\/addsubreddit\s*/i, '').trim();
  if (!sub) { await bot.sendMessage(msg.chat.id, 'Usage: /addsubreddit r/name'); return; }
  addSubreddit(sub);
  await bot.sendMessage(msg.chat.id, `✅ Now monitoring Reddit: r/${sub.replace(/^r\//, '')}`);
}

export async function removeSubredditCmd(bot, msg) {
  if (!adminOnly(bot, msg)) return;
  const sub = msg.text.replace(/^\/removesubreddit\s*/i, '').trim();
  if (!sub) { await bot.sendMessage(msg.chat.id, 'Usage: /removesubreddit r/name'); return; }
  removeSubreddit(sub);
  await bot.sendMessage(msg.chat.id, `✅ Removed Reddit: r/${sub.replace(/^r\//, '')}`);
}

export async function addYoutubeCmd(bot, msg) {
  if (!adminOnly(bot, msg)) return;
  const channelId = msg.text.replace(/^\/addyoutube\s*/i, '').trim();
  if (!channelId) {
    await bot.sendMessage(msg.chat.id, 'Usage: /addyoutube [channelId]\n\nFind the channel ID in the YouTube URL:\nyoutube.com/channel/UCxxxxxxxx\n\nExample: /addyoutube UCbmNph6atAoGfqLoCL_duAg');
    return;
  }
  addYoutubeChannel(channelId);
  await bot.sendMessage(msg.chat.id, `✅ Added YouTube channel: \`${channelId}\`\n\nUse /togglesource youtube to make sure YouTube is enabled.`);
}

export async function removeYoutubeCmd(bot, msg) {
  if (!adminOnly(bot, msg)) return;
  const channelId = msg.text.replace(/^\/removeyoutube\s*/i, '').trim();
  if (!channelId) { await bot.sendMessage(msg.chat.id, 'Usage: /removeyoutube [channelId]'); return; }
  removeYoutubeChannel(channelId);
  await bot.sendMessage(msg.chat.id, `✅ Removed YouTube channel: \`${channelId}\``);
}

export async function feedsCmd(bot, msg) {
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
  if (!adminOnly(bot, msg)) return;
  const url = msg.text.replace(/^\/addfeed\s*/i, '').trim();
  if (!url || !url.startsWith('http')) {
    await bot.sendMessage(msg.chat.id, 'Usage: /addfeed [rss-url]\nExample: /addfeed https://feeds.bbci.co.uk/news/rss.xml');
    return;
  }
  addRssFeed(url);
  await bot.sendMessage(msg.chat.id, `✅ Added RSS feed:\n\`${url}\`\n\nIt'll show up in your next /digest or /news search.`);
}

export async function removeFeedCmd(bot, msg) {
  if (!adminOnly(bot, msg)) return;
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
  if (!adminOnly(bot, msg)) return;
  const cfg = loadConfig();
  await send(bot, msg.chat.id, formatSourcesList(cfg));
}

export async function toggleSourceCmd(bot, msg) {
  if (!adminOnly(bot, msg)) return;
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
  if (!adminOnly(bot, msg)) return;
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
  if (!adminOnly(bot, msg)) return;
  setPaused(true);
  await bot.sendMessage(msg.chat.id, '⏸️ Alerts and digests paused. Send /resume to restart.');
}

export async function resumeCmd(bot, msg) {
  if (!adminOnly(bot, msg)) return;
  setPaused(false);
  await bot.sendMessage(msg.chat.id, '▶️ Alerts and digests resumed.');
}

// ─── Group Registration ───────────────────────────────────────────────────────

export async function registerCmd(bot, msg) {
  const chatId = String(msg.chat.id);
  const cfg = registerChat(chatId);
  const chatName = msg.chat.title || msg.chat.first_name || chatId;
  const digestTime = `${String(cfg.digest_hour).padStart(2,'0')}:${String(cfg.digest_minute).padStart(2,'0')} UTC`;
  await bot.sendMessage(msg.chat.id,
    `✅ *"${chatName}" is now registered!*\n\nThis chat will receive:\n• Daily digest at ${digestTime}\n• Breaking news alerts\n\nUse /unregister to stop.\n_Admins can change the time with /settime HH:MM_`
  );
}

export async function unregisterCmd(bot, msg) {
  unregisterChat(msg.chat.id);
  await bot.sendMessage(msg.chat.id, '✅ This chat has been unregistered. No more automatic digests or alerts.');
}

// ─── Memory & History ────────────────────────────────────────────────────────

export async function memoryCmd(bot, msg) {
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
