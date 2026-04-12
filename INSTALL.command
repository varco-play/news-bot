#!/bin/bash
# Double-click this file in Finder to install and test the bot
cd "$(dirname "$0")"
echo "🤖 Installing Jarvis News Bot..."
echo "================================"
rm -rf node_modules package-lock.json
npm install --no-fund 2>&1 | grep -v "^npm warn"
echo ""
echo "🧪 Running tests..."
node --no-warnings test.js
echo ""
echo "✅ Done! To start the bot, run:  node main.js"
echo "   (Make sure your .env file has your TELEGRAM_BOT_TOKEN)"
read -p "Press Enter to close..."
