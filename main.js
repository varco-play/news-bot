import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import { initDb } from './core/db.js';
import { setupScheduler } from './bot/scheduler.js';
import { loadConfig, registerChat } from './core/config.js';
import { chat } from './ai/queryEngine.js';
import {
  startCmd, helpCmd, digestCmd, newsCmd, askCmd, sCmd, topCmd, settingsCmd,
  panelCmd, topicsCmd, addTopicCmd, removeTopicCmd,
  alertsCmd, addAlertCmd, removeAlertCmd, setAlertLevelCmd,
  addTwitterCmd, removeTwitterCmd, addInstagramCmd, removeInstagramCmd,
  addSubredditCmd, removeSubredditCmd, addYoutubeCmd, removeYoutubeCmd,
  feedsCmd, addFeedCmd, removeFeedCmd,
  sourcesCmd, toggleSourceCmd, setTimeCmd, pauseCmd, resumeCmd,
  memoryCmd, historyCmd,
  registerCmd, unregisterCmd,
} from './bot/handlers.js';
import { splitMessage } from './bot/formatter.js';

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

// ─── Register bot commands for "/" autocomplete in Telegram ──────────────────
async function registerBotCommands() {
  try {
    await bot.setMyCommands([
      { command: 'digest', description: '📰 Get today\'s full news briefing' },
      { command: 'news', description: '🔍 Ask about any topic — e.g. /news AI' },
      { command: 's', description: '💬 Ask me anything — e.g. /s what\'s up with crypto?' },
      { command: 'ask', description: '🤔 Ask a question about current news' },
      { command: 'top', description: '🏆 Top stories from the last 48 hours' },
      { command: 'topics', description: '📋 What topics I\'m tracking' },
      { command: 'alerts', description: '🚨 Active alert rules' },
      { command: 'register', description: '📬 Get digests in this chat' },
      { command: 'unregister', description: '🔕 Stop getting digests here' },
      { command: 'history', description: '📜 Recent Q&A history' },
      { command: 'help', description: '📖 All commands' },
      { command: 'start', description: '👋 Welcome message' },
    ]);
    console.log('✅ Bot commands registered (/ autocomplete active).');
  } catch (err) {
    console.error('⚠️ Could not register bot commands:', err.message);
  }
}

// ─── Command map ─────────────────────────────────────────────────────────────
const commands = {
  start:         startCmd,
  help:          helpCmd,
  digest:        digestCmd,
  news:          newsCmd,
  ask:           askCmd,
  s:             sCmd,
  top:           topCmd,
  settings:      settingsCmd,
  panel:         panelCmd,
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

// Register handlers — pattern handles /cmd and /cmd@BotUsername (required in groups)
for (const [cmd, handler] of Object.entries(commands)) {
  bot.onText(new RegExp(`^\\/(?:${cmd})(?:@\\S+)?(?:\\s|$)`, 'i'), (msg) => {
    handler(bot, msg).catch(err => {
      console.error(`Error in /${cmd}:`, err.message);
      bot.sendMessage(msg.chat.id, `Ran into an error: ${err.message}`).catch(() => {});
    });
  });
}

// ─── Inline button callbacks ──────────────────────────────────────────────────
bot.on('callback_query', async (query) => {
  try {
    await bot.answerCallbackQuery(query.id);
    if (query.data === 'digest') {
      await digestCmd(bot, query.message);
    }
  } catch (err) {
    console.error('Callback error:', err.message);
  }
});

// ─── Mini App data handler ────────────────────────────────────────────────────
// When admin clicks a button in the WebApp, it sends data here
bot.on('web_app_data', async (msg) => {
  try {
    const data = JSON.parse(msg.web_app_data.data);
    if (data.action === 'command' && data.command) {
      // Simulate the command as if the admin typed it
      const fakeMsg = {
        ...msg,
        text: data.command,
        from: msg.from,
        chat: msg.chat,
      };
      const cmdMatch = data.command.match(/^\/(\w+)/);
      if (cmdMatch) {
        const cmdName = cmdMatch[1].toLowerCase();
        const handler = commands[cmdName];
        if (handler) {
          await handler(bot, fakeMsg);
        }
      }
    }
  } catch (err) {
    console.error('WebApp data error:', err.message);
  }
});

// ─── Plain-text conversational handler ───────────────────────────────────────
// Replies to any non-command message as SNEWS character
let botUsername = '';
bot.getMe().then(me => { botUsername = me.username; });

bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/') || msg.from?.is_bot) return;

  // In groups: only reply when mentioned or when someone replies to the bot
  if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
    const mentioned = botUsername && msg.text.toLowerCase().includes(`@${botUsername.toLowerCase()}`);
    const replyToBot = msg.reply_to_message?.from?.username === botUsername;
    if (!mentioned && !replyToBot) return;
  }

  try {
    await bot.sendChatAction(msg.chat.id, 'typing');
    const message = msg.text.replace(new RegExp(`@${botUsername}`, 'gi'), '').trim();
    const reply = await chat(message);

    for (const part of splitMessage(reply)) {
      try {
        await bot.sendMessage(msg.chat.id, part, {
          parse_mode: 'Markdown',
          reply_to_message_id: msg.message_id,
        });
      } catch {
        await bot.sendMessage(msg.chat.id, part, { reply_to_message_id: msg.message_id });
      }
    }
  } catch (err) {
    console.error('Chat handler error:', err.message);
  }
});

// ─── Scheduler + startup ─────────────────────────────────────────────────────
setupScheduler(bot);
registerBotCommands();

console.log('⚡ SNEWS Intelligence Bot is live! Press Ctrl+C to stop.');
if (CHAT_ID) {
  console.log(`📬 Auto-delivering digests to: ${CHAT_ID}`);
} else {
  console.log('📬 No TELEGRAM_CHAT_ID — use /register in any chat to get digests.');
}

// Graceful shutdown
process.on('SIGINT', () => { bot.stopPolling(); process.exit(0); });
process.on('SIGTERM', () => { bot.stopPolling(); process.exit(0); });
