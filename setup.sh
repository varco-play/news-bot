#!/bin/bash
# Jarvis News Bot — One-time setup script
# Run this once: bash setup.sh

set -e

echo "🤖 Jarvis Intelligence Bot — Setup"
echo "===================================="

# Check Node.js version
NODE_VER=$(node --version 2>/dev/null || echo "not found")
if [[ "$NODE_VER" == "not found" ]]; then
  echo "❌ Node.js not found. Install from https://nodejs.org (v22 or higher)"
  exit 1
fi

# Extract major version number
NODE_MAJOR=$(echo "$NODE_VER" | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "❌ Node.js $NODE_VER is too old. Need v22+ for built-in SQLite."
  echo "   Download from: https://nodejs.org"
  exit 1
fi
echo "✅ Node.js $NODE_VER"

# Check npm
NPM_VER=$(npm --version 2>/dev/null || echo "not found")
echo "✅ npm $NPM_VER"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
rm -rf node_modules package-lock.json
npm install --no-fund 2>&1 | grep -v "^npm warn"
echo "✅ Dependencies installed"

# Check .env file
if [ ! -f ".env" ]; then
  cp .env.example .env
  echo ""
  echo "📝 Created .env from template."
  echo "   ⚠️  Edit .env and add your TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID before running!"
else
  echo "✅ .env file exists"
fi

# Run tests
echo ""
echo "🧪 Running tests..."
node --no-warnings test.js

echo ""
echo "🚀 Setup complete! Run the bot with: node main.js"
