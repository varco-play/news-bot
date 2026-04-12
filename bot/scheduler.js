import cron from 'node-cron';
import { loadConfig } from '../core/config.js';
import { ingestDailyDigest, ingestSocialHighlights, ingestTopic } from '../pipeline/ingestion.js';
import { getBreakingArticles, formatAlert } from '../pipeline/alerting.js';
import { formatDailyDigest, splitMessage } from './formatter.js';
import { markAlertSent } from '../core/db.js';

let digestJob = null;
let alertJob = null;
let _bot = null;
let _paused = false;

export function isPaused() { return _paused; }
export function setPaused(val) { _paused = val; }

// Broadcast a message to every registered chat
async function broadcast(text) {
  const cfg = loadConfig();
  const chats = cfg.registered_chats || [];
  for (const chatId of chats) {
    for (const part of splitMessage(text)) {
      await _bot.sendMessage(chatId, part, { parse_mode: 'Markdown' })
        .catch(() => _bot.sendMessage(chatId, part).catch(() => {}));
    }
  }
}

async function sendDailyDigest() {
  if (_paused || !_bot) return;
  const cfg = loadConfig();
  if (!cfg.registered_chats || cfg.registered_chats.length === 0) return;

  try {
    console.log('[Scheduler] Running daily digest...');
    const topicArticles = await ingestDailyDigest();
    const socialPosts = await ingestSocialHighlights();
    const text = formatDailyDigest(topicArticles, socialPosts);
    await broadcast(text);
    console.log(`[Scheduler] Daily digest sent to ${cfg.registered_chats.length} chat(s).`);
  } catch (err) {
    console.error('[Scheduler] Digest error:', err.message);
  }
}

async function alertPoll() {
  if (_paused || !_bot) return;
  const cfg = loadConfig();
  if (!cfg.registered_chats || cfg.registered_chats.length === 0) return;

  try {
    // Ingest new articles for each topic
    for (const topic of cfg.topics) {
      await ingestTopic(topic, 5, true);
    }

    const breaking = getBreakingArticles();
    for (const article of breaking) {
      const text = formatAlert(article);
      await broadcast(text);
      markAlertSent(article.id);
    }

    if (breaking.length > 0) {
      console.log(`[Scheduler] Sent ${breaking.length} alert(s) to ${cfg.registered_chats.length} chat(s).`);
    }
  } catch (err) {
    console.error('[Scheduler] Alert poll error:', err.message);
  }
}

export function setupScheduler(bot) {
  _bot = bot;

  const cfg = loadConfig();
  const h = cfg.digest_hour || 8;
  const m = cfg.digest_minute || 0;
  const interval = cfg.alert_poll_interval_minutes || 30;

  // Stop existing jobs
  if (digestJob) digestJob.stop();
  if (alertJob) alertJob.stop();

  // Daily digest cron
  digestJob = cron.schedule(`${m} ${h} * * *`, sendDailyDigest, { timezone: 'UTC' });
  console.log(`[Scheduler] Daily digest at ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')} UTC`);

  // Alert polling cron
  alertJob = cron.schedule(`*/${interval} * * * *`, alertPoll);
  console.log(`[Scheduler] Alert polling every ${interval}min`);

  // Initial alert poll after 90 seconds
  setTimeout(alertPoll, 90_000);
}

export function restartScheduler() {
  if (_bot) setupScheduler(_bot);
}
