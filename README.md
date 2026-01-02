# FentAnalytics

if you liked this plz send money https://ko-fi.com/voryalis

my first discord bot that gives overall server stats "wrapped"-style. tracks server activity and posts a recap.
**check latest release**
---
## features
- message counts per user (bots ignored)
- voice channel time tracking
- game / activity tracking via discord presence
- favorite (most played) game per user
- privacy-aware handling when game activity is hidden
- top word frequency (words with length 3+)
- wrapped-style embeds
- persistent data using sqlite
---
- ## requirements
- Node.js **18+**
- discord bot token
- discord intents enabled in the developer portal:
  - **Message Content Intent**
  - **Presence Intent**
  - **Server Members Intent**
  - **Voice States**
 ---
# commands

### wrapped analytics

- `!wrapped`  
  shows a server-wide wrapped summary

- `!wrapped me`  
  shows your personal wrapped stats

- `!wrapped @user`  
  shows wrapped stats for a specific user, including:
  - avatar
  - display name
  - messages
  - voice time
  - top words
  - favorite game

if a user has game activity hidden in discord settings, the bot will display:

no game activity recorded.
check discord privacy settings
