# FentAnalytics
# Discord Wrapped Analytics Bot

A lightweight Discord bot that captures server activity and produces "wrapped"-style recaps: who chats the most, which games people play, voice channel time, and top words.

## Features
- Message counts per user.
- Voice channel time tracking per user.
- Game/activity time tracking using presence updates.
- Top word frequency per server.
- `!wrapped` command that posts a summary embed for the current server.

## Requirements
- Node.js 18+
- A Discord bot token with **MESSAGE CONTENT**, **PRESENCE**, **SERVER MEMBERS**, and **VOICE STATES** intents enabled in the Developer Portal.

Install dependencies:

```bash
npm install
```

## Running locally (beginner friendly)
1. Create a bot in the Discord Developer Portal and invite it to your server with the needed intents (Message Content, Presence, Server Members, Voice States).
2. Copy `.env.example` to `.env` and paste your token:
   ```bash
   cp .env.example .env
   ```
   Open `.env` and set `DISCORD_TOKEN=YOUR_BOT_TOKEN`. Leave the other values alone unless you want to customize them.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the bot:
   ```bash
   npm start
   ```

Use `!wrapped` in any server where the bot is present to see the current summary. Data is stored in the SQLite database for persistence across restarts.

## How tracking works
- **Messages**: counts every non-bot message and indexes words of length 3 or more.
- **Voice**: records join/leave and channel switches to accumulate time in seconds.
- **Activities**: captures time spent in "Playing" presence activities (e.g., games). Other activity types are ignored to keep the focus on games.

## Testing and quick checks
- Lint the bot script (fast sanity check):
  ```bash
  npm run lint
  ```
- Verify Node.js version (should be 18+):
  ```bash
  node -v
  ```
- If the bot does not respond, double-check the intents in the Developer Portal and that `DISCORD_TOKEN` in your `.env` is correct.

## Resetting data
To start fresh, stop the bot and delete the SQLite database file configured by `DISCORD_ANALYTICS_DB` (defaults to `analytics.db`)
