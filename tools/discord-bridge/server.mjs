import destination from './destination.json' with { type: 'json' };
import { DiscordError, discordClient } from './discord.mjs';
import { serveDiscordBridge } from './mcp.mjs';

try {
  const request = discordClient({ token: process.env.DISCORD_BOT_TOKEN });
  await serveDiscordBridge(destination, request);
} catch (error) {
  const detail = error instanceof DiscordError ? error.message : 'Unexpected startup error.';
  console.error(`Discord bridge could not start. ${detail}`);
  process.exitCode = 1;
}
