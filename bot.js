require('dotenv').config();

const sqlite3 = require('sqlite3').verbose();
const {
    ActivityType,
    Client,
    EmbedBuilder,
    Events,
    GatewayIntentBits,
} = require('discord.js');

const BOT_NAME = "FentAnalytics";

const DB_FILE = process.env.DISCORD_ANALYTICS_DB || 'analytics.db';
const COMMAND_PREFIX = process.env.DISCORD_ANALYTICS_PREFIX || '!';

const WORD_REGEX = /\b\w{3,}\b/gu;

function extractWords(content = '') {
    const matches = content.toLocaleLowerCase().match(WORD_REGEX);
    return matches ? matches : [];
}

function formatDuration(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts = [];

    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}m`);
    if (seconds || !parts.length) parts.push(`${seconds}s`);

    return parts.join(' ');
}

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

class AnalyticsStore {
    constructor(path = DB_FILE) {
      this.db = new sqlite3.Database(path);
      this.db.serialize();
      this.ready = this.setup();
    }

    async setup() {
        await run(this.db, 'PRAGMA journal_mode=WAL;');
        await run(
            this.db,
            `CREATE TABLE IF NOT EXISTS messages (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, user_id)
     )`
        );
        await this.ensureWordsTable();
        await run(
            this.db,
            `CREATE TABLE IF NOT EXISTS voice_time (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        seconds INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, user_id)
      )`
        );
        await run(
            this.db,
            `CREATE TABLE IF NOT EXISTS activities (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        seconds INTEGER NOT NULL DEFAULT 0,
         PRIMARY KEY (guild_id, user_id, name)
      )`
        );
        await run(
            this.db,
            `CREATE TABLE IF NOT EXISTS ate_food (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, user_id)
      )`
        );
    }

    async incrementMessage(guildId, userId) {
        await this.ready;
        await run(
            this.db,
            `INSERT INTO messages (guild_id, user_id, count)
            VALUES (?, ?, 1)
            ON CONFLICT(guild_id, user_id) DO UPDATE SET count = count + 1`,
           [guildId, userId]
        );
    }

    async ensureWordsTable() {
        const columns = await all(this.db, 'PRAGMA table_info(words)');
        if (!columns.length) {
            await this.createWordsTable('words');
            await this.ensureWordsIndex();
            return;
        }

        const hasUserId = columns.some((column) => column.name === 'user_id');
        const primaryKeyColumns = columns
            .filter((column) => column.pk > 0)
            .sort((a, b) => a.pk - b.pk)
            .map((column) => column.name);
        const hasDesiredPrimaryKey =
            primaryKeyColumns.length === 3 &&
            primaryKeyColumns[0] === 'guild_id' &&
            primaryKeyColumns[1] === 'user_id' &&
            primaryKeyColumns[2] === 'word';
        const hasLegacyIndex = await this.hasLegacyGuildWordIndex();

        if (hasUserId && hasDesiredPrimaryKey && !hasLegacyIndex) {
            await this.ensureWordsIndex();
            return;
        }

        await this.rebuildWordsTable(columns);
    }

    async createWordsTable(tableName) {
        await run(
            this.db,
            `CREATE TABLE IF NOT EXISTS ${tableName} (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        word TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, user_id, word)
      )`
        );
    }

    async rebuildWordsTable(existingColumns = []) {
        const hasUserId = existingColumns.some((column) => column.name === 'user_id');
        await run(this.db, 'DROP TABLE IF EXISTS words_new');
        await this.createWordsTable('words_new');

        if (existingColumns.length) {
            const copySql = hasUserId
                ? `INSERT INTO words_new (guild_id, user_id, word, count)
             SELECT guild_id, COALESCE(user_id, '') as user_id, word, SUM(count) as count FROM words GROUP BY guild_id, user_id, word`
                : `INSERT INTO words_new (guild_id, user_id, word, count)
             SELECT guild_id, '' as user_id, word, SUM(count) as count FROM words GROUP BY guild_id, word`;
            await run(this.db, copySql);
            await run(this.db, 'DROP TABLE words');
        }

        await run(this.db, 'ALTER TABLE words_new RENAME TO words');
        await this.ensureWordsIndex();
    }

    async dropLegacyWordIndexes() {
        const indexes = await all(this.db, "PRAGMA index_list('words')");
        for (const index of indexes) {
            const safeName = index.name?.replace(/"/g, '""');
            if (!safeName) continue;
            const columns = await all(this.db, `PRAGMA index_info("${safeName}")`);
            const columnNames = columns.map((column) => column.name);
            const isLegacyGuildWordIndex =
                columnNames.length === 2 &&
                columnNames[0] === 'guild_id' &&
                columnNames[1] === 'word';

            if (isLegacyGuildWordIndex) {
                await run(this.db, `DROP INDEX IF EXISTS "${safeName}"`);
            }
        }
    }

    async hasLegacyGuildWordIndex() {
        const indexes = await all(this.db, "PRAGMA index_list('words')");
        for (const index of indexes) {
            const safeName = index.name?.replace(/"/g, '""');
            if (!safeName) continue;
            const columns = await all(this.db, `PRAGMA index_info("${safeName}")`);
            const columnNames = columns.map((column) => column.name);
            const isLegacyGuildWordIndex =
                columnNames.length === 2 &&
                columnNames[0] === 'guild_id' &&
                columnNames[1] === 'word';

            if (isLegacyGuildWordIndex) return true;
        }
        return false;
    }

    async ensureWordsIndex() {
        await this.dropLegacyWordIndexes();
        await run(
            this.db,
            'CREATE UNIQUE INDEX IF NOT EXISTS idx_words_guild_user_word ON words (guild_id, user_id, word)'
        );
    }

    async incrementWords(guildId, userId, words) {
        await this.ready;
        const normalized = words.map((word) => word.toLocaleLowerCase());
        const sql = `INSERT INTO words (guild_id, user_id, word, count)
                     VALUES (?, ?, ?, 1)
                     ON CONFLICT(guild_id, user_id, word) DO UPDATE SET count = count + 1`;

        for (const word of normalized) {
          await run(this.db, sql, [guildId, userId, word]);
        }
    }

    async addVoiceSeconds(guildId, userId, seconds) {
        if (seconds <= 0) return;
        await this.ready;
        await run(
          this.db,
          `INSERT INTO voice_time (guild_id, user_id, seconds)
           VALUES (?, ?, ?)
           ON CONFLICT(guild_id, user_id) DO UPDATE SET seconds = seconds + excluded.seconds`,
          [guildId, userId, seconds]
        );
      }

      async addActivitySeconds(guildId, userId, name, seconds) {
        if (seconds <= 0) return;
        await this.ready;
        await run(
          this.db,
          `INSERT INTO activities (guild_id, user_id, name, seconds)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(guild_id, user_id, name) DO UPDATE SET seconds = seconds + excluded.seconds`,
          [guildId, userId, name, seconds]
        );
      }

      async getMessageLeaderboard(guildId, limit = 5) {
        await this.ready;
        return all(
          this.db,
          `SELECT user_id as userId, count FROM messages WHERE guild_id = ?
           ORDER BY count DESC LIMIT ?`,
          [guildId, limit]
        );
      }

      async getVoiceLeaderboard(guildId, limit = 5) {
        await this.ready;
        return all(
          this.db,
          `SELECT user_id as userId, seconds FROM voice_time WHERE guild_id = ?
           ORDER BY seconds DESC LIMIT ?`,
          [guildId, limit]
        );
      }

      async getWordLeaderboard(guildId, limit = 5) {
        await this.ready;
        return all(
          this.db,
          `SELECT word as name, SUM(count) as value FROM words WHERE guild_id = ?
           GROUP BY word ORDER BY value DESC LIMIT ?`,
          [guildId, limit]
        );
      }

      async getActivityLeaderboard(guildId, limit = 5) {
        await this.ready;
        return all(
          this.db,
          `SELECT name, seconds as value FROM activities WHERE guild_id = ?
           ORDER BY seconds DESC LIMIT ?`,
          [guildId, limit]
        );
      }

      async getUserStatsForGuild(guildId, userId, limit = 5) {
        await this.ready;
        const [messageRow] = await all(
          this.db,
          `SELECT count FROM messages WHERE guild_id = ? AND user_id = ? LIMIT 1`,
          [guildId, userId]
        );
        const [voiceRow] = await all(
          this.db,
          `SELECT seconds FROM voice_time WHERE guild_id = ? AND user_id = ? LIMIT 1`,
          [guildId, userId]
        );
        const activities = await all(
          this.db,
          `SELECT name, seconds as value FROM activities WHERE guild_id = ? AND user_id = ?
           ORDER BY seconds DESC LIMIT ?`,
          [guildId, userId, limit]
        );
        const words = await all(
          this.db,
          `SELECT word as name, count as value FROM words WHERE guild_id = ? AND user_id = ?
           ORDER BY count DESC LIMIT ?`,
          [guildId, userId, limit]
        );

        return {
          messages: messageRow?.count || 0,
          voiceSeconds: voiceRow?.seconds || 0,
          activities,
          words,
        };
      }

      async incrementAteFood(guildId, userId) {
        await this.ready;
        await run(
          this.db,
          `INSERT INTO ate_food (guild_id, user_id, count)
           VALUES (?, ?, 1)
           ON CONFLICT(guild_id, user_id) DO UPDATE SET count = count + 1`,
          [guildId, userId]
        );
        const [row] = await all(
          this.db,
          `SELECT count FROM ate_food WHERE guild_id = ? AND user_id = ? LIMIT 1`,
          [guildId, userId]
        );
        return row?.count || 0;
      }
}

function getPlayingActivity(presence) {
    if (!presence) return null;
    for (const activity of presence.activities || []) {
        if (activity?.type === ActivityType.Playing && activity.name) {
            return activity.name;
        }
    }
    if (presence.activity?.type === ActivityType.Playing && presence.activity.name) {
        return presence.activity.name;
    }
    return null;
}

async function buildUserLeaderboard(guild, rows, formatter = (value) =>  `${value}`) {
    if (!rows.length) return 'No data yet. Start chatting!';
    const lines = [];

    for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const position = index + 1;
        let displayName = `User ${row.userId}`;

        try {
            const member = await guild.members.fetch(row.userId);
            if (member) displayName = member.displayName;
        } catch (error) {
            // Ignore fetch errors, leave fallback name
        }

        lines.push(`${position}. **${displayName}** — ${formatter(row.count ?? row.seconds)}`);
    }

    return lines.join('\n');
}

function buildNamedLeaderboard(rows, formatter = (value) =>  `${value}`) {
    if(!rows.length) return 'No data yet.';
    return rows
    .map((entry, idx) => `${idx + 1}. **${entry.name}** — ${formatter(entry.value)}`)
    .join('\n');
}

async function sendServerWrapped(message, store) {
    const guild = message.guild;
    if (!guild) {
        await message.reply('This command only works in servers.');
        return;
    }

    const guildId = guild.id;
    const embed = new EmbedBuilder()
    .setTitle(`${BOT_NAME} • Wrapped`)
    .setDescription("Here are your community's highlights")
    .setColor(0x5865f2)
    .setFooter({ text: `${BOT_NAME} Analytics Bot` });

    const [messages, voice, activities, words] = await Promise.all([
        store.getMessageLeaderboard(guildId),
        store.getVoiceLeaderboard(guildId),
        store.getActivityLeaderboard(guildId),
        store.getWordLeaderboard(guildId),
    ]);

    embed.addFields(
        {
            name: 'Top Chatters',
            value: await buildUserLeaderboard(guild, messages, (value) => value.toLocaleString()),
        },
        {
            name: 'Voice Channel Champions',
            value: await buildUserLeaderboard(guild, voice, formatDuration),
        },
        {
            name: 'Favorite Games',
            value: buildNamedLeaderboard(activities, formatDuration),
        },
        {
            name: 'Most Used Words',
            value: buildNamedLeaderboard(words, (value) => value.toLocaleString()),
        }
    );

    await message.reply({ embeds: [embed] });
}

async function sendUserWrapped(message, user, store) {
    const guild = message.guild;
    if (!guild) {
        await message.reply('This command only works in servers.');
        return;
    }

    const guildId = guild.id;
    const stats = await store.getUserStatsForGuild(guildId, user.id);
    const member = await guild.members.fetch(user.id).catch(() => null);
    const displayName = member?.displayName || user.tag || user.username;
    const favoriteGame = stats.activities?.[0];
    const favoriteGameValue = favoriteGame
      ? `${favoriteGame.name} — ${formatDuration(favoriteGame.value)}`
      : 'No game activity recorded — check Discord privacy settings';
    const embed = new EmbedBuilder()
      .setTitle(`${BOT_NAME} • Wrapped`)
      .setDescription(`**${displayName}** personal stats for **${guild.name}**`)
      .setColor(0x5865f2)
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .setFooter({ text: `${BOT_NAME} Analytics Bot` })
      .addFields(
        {
            name: 'Messages',
            value: stats.messages ? stats.messages.toLocaleString() : '0',
            inline: true,
        },
        {
            name: 'Voice Time',
            value: stats.voiceSeconds ? formatDuration(stats.voiceSeconds) : '0s',
            inline: true,
        },
        {
            name: 'Favorite Game',
            value: favoriteGameValue,
            inline: false,
        },
        {
            name: 'Top Words',
            value: buildNamedLeaderboard(stats.words, (value) => value.toLocaleString()),
        }
      );

    if (stats.activities?.length) {
        embed.addFields({
            name: 'Top Games',
            value: buildNamedLeaderboard(stats.activities, formatDuration),
        });
    }

    await message.reply({ embeds: [embed] });
}

if (!process.env.DISCORD_TOKEN) {
  throw new Error('Please set the DISCORD_TOKEN environment variable.');
}

const store = new AnalyticsStore();
const voiceSessions = new Map();
const activitySessions = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences,
  ],
});

client.once(Events.ClientReady, (readyClient) => {
  // eslint-disable-next-line no-console
  console.log(`${BOT_NAME} is online as ${readyClient.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  if (!message.guild || message.author.bot) return;

  await store.incrementMessage(message.guild.id, message.author.id);
  const words = extractWords(message.content);
  if (words.length) await store.incrementWords(message.guild.id, message.author.id, words);

  if (!message.content.startsWith(COMMAND_PREFIX)) return;
  const trimmed = message.content.slice(COMMAND_PREFIX.length).trim();
  if (!trimmed) return;

  const [command, ...args] = trimmed.split(/\s+/);
  const commandName = command.toLowerCase();

  if (commandName === 'wrapped') {
    if (!args.length) {
      await sendServerWrapped(message, store);
      return;
    }

    const firstArg = args[0].toLowerCase();
    if (firstArg === 'me') {
      await sendUserWrapped(message, message.author, store);
      return;
    }

    const mentionedUser = message.mentions.users.first();
    if (mentionedUser) {
      await sendUserWrapped(message, mentionedUser, store);
      return;
    }

    await message.reply('Use !wrapped, !wrapped me, or !wrapped @user.');
    return;
  }

  if (commandName === 'rape' && args.length === 1 && args[0].toLowerCase() === 'food') {
    const count = await store.incrementAteFood(message.guild.id, message.author.id);
    const embed = new EmbedBuilder()
      .setDescription(`you have raped food ${count} times`)
      .setImage('https://i.imgur.com/8agRGxQ.gif');

    // Reply first (without ping), but fall back to a channel send if the reference is missing.
    try {
      await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
    } catch (error) {
      await message.channel.send({ embeds: [embed] });
    }
    }
  });

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const guildId = newState.guild.id;
  const userId = newState.id;
  const key = `${guildId}:${userId}`;
  const now = Math.floor(Date.now() / 1000);

  const previousChannel = oldState.channelId;
  const currentChannel = newState.channelId;

  if (previousChannel && !currentChannel) {
    const startedAt = voiceSessions.get(key);
    if (startedAt) {
      await store.addVoiceSeconds(guildId, userId, now - startedAt);
      voiceSessions.delete(key);
    }
    return;
  }

  if (previousChannel !== currentChannel) {
    const startedAt = voiceSessions.get(key);
    if (startedAt) {
      await store.addVoiceSeconds(guildId, userId, now - startedAt);
    }
    if (currentChannel) {
      voiceSessions.set(key, now);
    } else {
      voiceSessions.delete(key);
    }
    return;
  }

  if (currentChannel && !voiceSessions.has(key)) {
    voiceSessions.set(key, now);
  }
});

client.on(Events.PresenceUpdate, async (oldPresence, newPresence) => {
  if (!newPresence?.guild) return;

  const guildId = newPresence.guild.id;
  const userId = newPresence.userId;
  const key = `${guildId}:${userId}`;
  const now = Math.floor(Date.now() / 1000);

  const previous = getPlayingActivity(oldPresence);
  const current = getPlayingActivity(newPresence);
  const activeSession = activitySessions.get(key);

  if (activeSession && (!current || activeSession.name !== current)) {
    await store.addActivitySeconds(guildId, userId, activeSession.name, now - activeSession.startedAt);
    activitySessions.delete(key);
  }

  if (current && (!activeSession || activeSession.name !== current)) {
    activitySessions.set(key, { name: current, startedAt: now });
  }
});

client.login(process.env.DISCORD_TOKEN);
