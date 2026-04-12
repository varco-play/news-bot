import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import { initDb } from './core/db.js';
import { setupScheduler } from './bot/scheduler.js';
import { loadConfig, registerChat } from './core/config.js';
import { chat } from './ai/queryEngine.js';
import {
  startCmd, helpCmd, digestCmd, newsCmd, askCmd, topCmd, settingsCmd,
  topicsCmd, addTopicCmd, removeTopicCmd,
  alertsCmd, addAlertCmd, removeAlertCmd, setAlertLevelCmd,
  addTwitterCmd, removeTwitterCmd, addInstagramCmd, removeInstagramCmd,
  addSubredditCmd, removeSubredditCmd, addYoutubeCmd, removeYoutubeCmd,
  feedsCmd, addFeedCmd, removeFeedCmd,
  sourcesCmd, toggleSourceCmd, setTimeCmd, pauseCmd, resumeCmd,
  memoryCmd, historyCmd,
  registerCmd, unregisterCmd,
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

// Auto-register the owner's chat for digests (backwards compat)
if (CHAT_ID) {
  registerChat(CHAT_ID);
}

// Create bot
const bot = new TelegramBot(TOKEN, { polling: true });

// Command map
const commands = {
  start:         startCmd,
  help:          helpCmd,
  digest:        digestCmd,
  news:          newsCmd,
  ask:           askCmd,
  top:           topCmd,
  settings:      settingsCmd,
  topics:        topicsCmd,
  addtopic:      addTopicCmd,
  removetopic:   removeTopicCmd,
  alerts:        alertsCmd,
  addalert:      addAlertCmd,
  removealert:   removeAlertCmd,
  setalertlevel: setAlertLevelCmd,
  addtwitter:    addTwitterCmd,
  removetwitter: removeTwitterCmd,
  addinstagram:  addInstagramCmd,
  removeinstagram: removeInstagramCmd,
  addsubreddit:  addSubredditCmd,
  removesubreddit: removeSubredditCmd,
  addyoutube:    addYoutubeCmd,
  removeyoutube: removeYoutubeCmd,
  feeds:         feedsCmd,
  addfeed:       addFeedCmd,
  removefeed:    removeFeedCmd,
  sources:       sourcesCmd,
  togglesource:  toggleSourceCmd,
  settime:       setTimeCmd,
  pause:         pauseCmd,
  resume:        resumeCmd,
  memory:        memoryCmd,
  history:       historyCmd,
  register:      registerCmd,
  unregister:    unregisterCmd,
};

// Register handlers — pattern handles both /cmd and /cmd@BotUsername (required in groups)
for (const [cmd, handler] of Object.entries(commands)) {
  bot.onText(new RegExp(`^\\/(?:${cmd})(?:@\\S+)?(?:\\s|$)`, 'i'), (msg) => {
    handler(bot, msg).catch(err => {
      console.error(`Error in /${cmd}:`, err.message);
      bot.sendMessage(msg.chat.id, `❌ Error: ${err.message}`).catch(() => {});
    });
  });
}

// Plain-text message handler — respond conversationally to anything that's not a command
bot.on('message', async (msg) => {
  // Ignore commands (they're handled above), non-text, and messages from bots
  if (!msg.text || msg.text.startsWith('/') || msg.from?.is_bot) return;

  // In groups, only reply if the bot is mentioned or someone is replying to the bot
  if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
    const botUsername = (await bot.getMe()).username;
    const mentionedBot = msg.text.toLowerCase().includes(`@${botUsername.toLowerCase()}`);
    const replyToBot = msg.reply_to_message?.from?.is_bot;
    if (!mentionedBot && !replyToBot) return;
  }

  try {
    // Show typing indicator
    await bot.sendChatAction(msg.chat.id, 'typing');
    const message = msg.text.replace(/@\S+/g, '').trim(); // strip @mentions
    const reply = await chat(message);
    // Send reply — try markdown, fall back to plain
    try {
      await bot.sendMessage(msg.chat.id, reply, { parse_mode: 'Markdown', reply_to_message_id: msg.message_id });
    } catch {
      await bot.sendMessage(msg.chat.id, reply, { reply_to_message_id: msg.message_id });
    }
  } catch (err) {
    console.error('Chat handler error:', err.message);
  }
});

// Set up scheduled jobs — sends to ALL registered chats
setupScheduler(bot);

console.log('🤖 Jarvis Intelligence Bot is running! Press Ctrl+C to stop.');
if (CHAT_ID) {
  console.log(`📬 Sending digests to chat: ${CHAT_ID}`);
} else {
  console.log('📬 No TELEGRAM_CHAT_ID set — use /register in any chat to get digests.');
}

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
