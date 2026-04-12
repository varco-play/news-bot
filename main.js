import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import { initDb } from './core/db.js';
import { setupScheduler } from './bot/scheduler.js';
import {
  startCmd, helpCmd, digestCmd, newsCmd, askCmd, topCmd, settingsCmd,
  topicsCmd, addTopicCmd, removeTopicCmd,
  alertsCmd, addAlertCmd, removeAlertCmd, setAlertLevelCmd,
  addTwitterCmd, removeTwitterCmd, addInstagramCmd, removeInstagramCmd,
  addSubredditCmd, removeSubredditCmd, addYoutubeCmd, removeYoutubeCmd,
  feedsCmd, addFeedCmd, removeFeedCmd,
  sourcesCmd, toggleSourceCmd, setTimeCmd, pauseCmd, resumeCmd,
  memoryCmd, historyCmd,
} from './bot/handlers.js';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN not set. Check your .env file.');
  process.exit(1);
}

// Initialize database
initDb();
console.log('✅ Database initialized.');

// Create bot
const bot = new TelegramBot(TOKEN, { polling: true });

// Register command handlers
const commands = {
  start: startCmd,
  help: helpCmd,
  digest: digestCmd,
  news: newsCmd,
  ask: askCmd,
  top: topCmd,
  settings: settingsCmd,
  topics: topicsCmd,
  addtopic: addTopicCmd,
  removetopic: removeTopicCmd,
  alerts: alertsCmd,
  addalert: addAlertCmd,
  removealert: removeAlertCmd,
  setalertlevel: setAlertLevelCmd,
  addtwitter: addTwitterCmd,
  removetwitter: removeTwitterCmd,
  addinstagram: addInstagramCmd,
  removeinstagram: removeInstagramCmd,
  addsubreddit: addSubredditCmd,
  removesubreddit: removeSubredditCmd,
  addyoutube: addYoutubeCmd,
  removeyoutube: removeYoutubeCmd,
  feeds: feedsCmd,
  addfeed: addFeedCmd,
  removefeed: removeFeedCmd,
  sources: sourcesCmd,
  togglesource: toggleSourceCmd,
  settime: setTimeCmd,
  pause: pauseCmd,
  resume: resumeCmd,
  memory: memoryCmd,
  history: historyCmd,
};

for (const [cmd, handler] of Object.entries(commands)) {
  bot.onText(new RegExp(`^\\/${cmd}(\\s|$)`, 'i'), (msg) => {
    handler(bot, msg).catch(err => {
      console.error(`Error in /${cmd}:`, err.message);
      bot.sendMessage(msg.chat.id, `❌ Error: ${err.message}`).catch(() => {});
    });
  });
}

// Setup scheduled jobs
if (CHAT_ID) {
  setupScheduler(bot, CHAT_ID);
}

console.log('🤖 Jarvis Intelligence Bot is running! Press Ctrl+C to stop.');

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  bot.stopPolling();
  process.exit(0);
});

process.on('SIGTERM', () => {
  bot.stopPolling();
  process.exit(0);
});
