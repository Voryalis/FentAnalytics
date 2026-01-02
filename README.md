# FentAnalytics
my first discord bot that gives overall server stats "wrapped"-style. tracks server activity and posts a recap.

## features
- message counts per user (ignores bot messages)
- voice channel time tracking per user
- game/activity time tracking (presence updates; focuses on “Playing”)
- top word frequency per server (words length 3+)
- `!wrapped` command to post a recap embed for the current server

- ## requirements
- Node.js **18+**
- discord bot token
- discord intents enabled in the developer portal:
  - **Message Content Intent**
  - **Presence Intent**
  - **Server Members Intent**
  - **Voice States**
 
## setup 

### 1) download / open the project
Open the project folder in VS Code (the folder that contains `package.json` and `bot.js`).

### 2) install dependencies
```bash
npm install
npm install dotenv
