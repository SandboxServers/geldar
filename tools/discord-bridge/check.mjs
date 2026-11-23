import destination from './destination.json' with { type: 'json' };
import { checkConnection, discordClient } from './discord.mjs';

try {
  const request = discordClient({ token: process.env.DISCORD_BOT_TOKEN });
  const { bot, server, channel } = await checkConnection(destination, request);
  console.log(JSON.stringify({ bot, server, channel }));
  console.log('The bot can see the configured channel. Reading history and posting are unchecked.');
} catch (error) {
  console.error(`Discord connection check failed. ${error.message}`);
  process.exitCode = 1;
}
