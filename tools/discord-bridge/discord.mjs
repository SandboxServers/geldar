const api = 'https://discord.com/api/v10';
export const snowflake = /^[0-9]{17,20}$/;

export class DiscordError extends Error {}

export function discordClient({ token, fetchImpl = fetch }) {
  if (!token?.trim()) {
    throw new DiscordError(
      'Set DISCORD_BOT_TOKEN in .env.discord or in your environment, then retry.',
    );
  }

  return async (path, missingAccessMessage, { body, invalidRequestMessage } = {}) => {
    const sending = body !== undefined;
    const sendUnconfirmed =
      'Discord may have posted the message. Check the channel before resending.';
    let response;
    try {
      response = await fetchImpl(`${api}${path}`, {
        method: sending ? 'POST' : 'GET',
        headers: {
          Authorization: `Bot ${token.trim()}`,
          ...(sending && { 'Content-Type': 'application/json' }),
        },
        body: sending ? JSON.stringify(body) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new DiscordError(
        sending
          ? `Could not confirm the Discord send. ${sendUnconfirmed}`
          : 'Could not reach Discord. Check your network connection and retry.',
      );
    }

    if (response.status === 401) {
      throw new DiscordError('Discord rejected the token. Check the bot token in .env.discord.');
    }
    if (response.status === 403 || response.status === 404) {
      throw new DiscordError(missingAccessMessage ?? 'Discord denied access to this resource.');
    }
    if (response.status === 400 && invalidRequestMessage) {
      throw new DiscordError(invalidRequestMessage);
    }
    if (response.status === 429) {
      throw new DiscordError('Discord rate-limited the request. Wait before trying again.');
    }
    if (!response.ok) {
      const advice = sending ? sendUnconfirmed : 'Try again later.';
      throw new DiscordError(`Discord returned HTTP ${response.status}. ${advice}`);
    }
    try {
      return await response.json();
    } catch {
      const advice = sending ? sendUnconfirmed : 'Try again later.';
      throw new DiscordError(`Discord returned an unreadable response. ${advice}`);
    }
  };
}

export async function checkConnection({ serverId, channelId }, request) {
  if (
    typeof serverId !== 'string' ||
    !snowflake.test(serverId) ||
    typeof channelId !== 'string' ||
    !snowflake.test(channelId)
  ) {
    throw new DiscordError(
      'Set the shared Discord server and channel IDs in destination.json first.',
    );
  }

  const bot = await request('/users/@me');
  if (bot?.bot !== true) {
    throw new DiscordError('Use the bot token from the Bot page in the Discord Developer Portal.');
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
  if (channel?.guild_id !== serverId || channel.type !== 0) {
    throw new DiscordError('Choose a regular text channel in the configured Discord server.');
  }

  return { bot: bot.username, server: server.name, channel: channel.name };
}
