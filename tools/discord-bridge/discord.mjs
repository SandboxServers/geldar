const api = 'https://discord.com/api/v10';
const snowflake = /^[0-9]{17,20}$/;

export function discordClient({ token, fetchImpl = fetch }) {
  if (!token?.trim()) {
    throw new Error('Set DISCORD_BOT_TOKEN in .env.discord or in your environment, then retry.');
  }

  return async (path, missingAccessMessage) => {
    let response;
    try {
      response = await fetchImpl(`${api}${path}`, {
        headers: { Authorization: `Bot ${token.trim()}` },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error('Could not reach Discord. Check your network connection and retry.');
    }

    if (response.status === 401) {
      throw new Error('Discord rejected the token. Check the bot token in .env.discord.');
    }
    if (response.status === 403 || response.status === 404) {
      throw new Error(missingAccessMessage ?? 'Discord denied access to this resource.');
    }
    if (response.status === 429) {
      throw new Error('Discord rate-limited the connection check. Wait a moment and retry.');
    }
    if (!response.ok) {
      throw new Error(`Discord returned HTTP ${response.status}. Retry the connection check.`);
    }
    try {
      return await response.json();
    } catch {
      throw new Error('Discord returned an unreadable response. Retry the connection check.');
    }
  };
}

export async function checkConnection({ serverId, channelId }, request) {
  if (!snowflake.test(serverId ?? '') || !snowflake.test(channelId ?? '')) {
    throw new Error('Set the shared Discord server and channel IDs in destination.json first.');
  }

  const bot = await request('/users/@me');
  if (bot.bot !== true) {
    throw new Error('Use the bot token from the Bot page in the Discord Developer Portal.');
  }

  const server = await request(
    `/guilds/${serverId}`,
    'The bot cannot access the configured Discord server. Install the app in that server using ' +
      'its Server Install link. If it is already installed, check the server ID and bot token.',
  );
  const channel = await request(
    `/channels/${channelId}`,
    'The bot can access the server but cannot see the configured channel. Ask a server admin ' +
      'to assign the bot the Geldar-Agent role, then check the channel ID and View Channel permission.',
  );
  if (channel.guild_id !== serverId || channel.type !== 0) {
    throw new Error('Choose a regular text channel in the configured Discord server.');
  }

  return { bot: bot.username, server: server.name, channel: channel.name };
}
