/**
 * MH-8a muffle-chat entry point. Runs the multi-bot chat on a throwaway bench shard, or summarizes a
 * server log that holds `muffle-bench` lines. Not wired into bench/cli.ts: the scenario registry drives
 * one bot, and muffle-chat drives 9 or 15.
 *
 *   node --experimental-strip-types golem/src/bench/muffle-chat-cli.ts --bots 9 \
 *     --mc-port 26565 --rcon-port 26575 --nats-url nats://127.0.0.1:14222
 *   node --experimental-strip-types golem/src/bench/muffle-chat-cli.ts --summarize <log file>
 *
 * RCON whitelist/tp/fill here is a test-harness operator control on a throwaway bench shard only; it is
 * never used on a real shard. Principle 1 concerns the real world.
 */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { loadConfig } from '../config.ts';
import { parseMuffleLog, summarizeMuffle } from './muffle-log.ts';
import {
  assertThrowawayTarget,
  BENCH_SIZES,
  muffleLayout,
  runMuffleChat,
  THROWAWAY_FLAG,
} from './scenarios/muffle-chat.ts';

const USAGE =
  'usage: muffle-chat-cli (--bots <9|15> [--mc-port <n>] [--rcon-port <n>] [--nats-url <url>] ' +
  `[${THROWAWAY_FLAG}] | --summarize <log file>)`;

/** Runs the command and returns the exit code: 0 ok, 1 refused or failed, 2 bad usage. */
export async function main(argv: string[]): Promise<number> {
  let values: Record<string, string | boolean | undefined>;
  try {
    values = parseArgs({
      args: argv,
      allowPositionals: false,
      options: {
        bots: { type: 'string' },
        'mc-port': { type: 'string' },
        'rcon-port': { type: 'string' },
        'nats-url': { type: 'string' },
        summarize: { type: 'string' },
        [THROWAWAY_FLAG.slice(2)]: { type: 'boolean' },
      },
    }).values;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    return 2;
  }

  if (typeof values.summarize === 'string') {
    const records = parseMuffleLog(await readFile(values.summarize, 'utf8'));
    console.log(JSON.stringify(summarizeMuffle(records), null, 2));
    return 0;
  }

  const bots = Number(values.bots);
  if (!(BENCH_SIZES as readonly number[]).includes(bots)) {
    console.error(`--bots must be 9 or 15\n${USAGE}`);
    return 2;
  }
  const mcPort = Number(values['mc-port'] ?? 26565);
  const rconPort = Number(values['rcon-port'] ?? 26575);
  const throwaway = values[THROWAWAY_FLAG.slice(2)] === true;
  try {
    assertThrowawayTarget(rconPort, throwaway);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const cfg = loadConfig({
    ...process.env,
    GELDAR_MC_HOST: '127.0.0.1',
    GELDAR_MC_PORT: String(mcPort),
    GELDAR_RCON_PORT: String(rconPort),
    GELDAR_NATS_URL: (values['nats-url'] as string | undefined) ?? 'nats://127.0.0.1:14222',
  });
  const layout = muffleLayout(bots);
  for (const spot of layout.spots) {
    console.log(
      `${spot.name} ${spot.role} x=${spot.x} z=${spot.z} distance=${spot.distance} blocks=[${spot.blocks.join(', ')}]`,
    );
  }
  try {
    const result = await runMuffleChat({
      bots,
      cfg,
      throwawayFlag: throwaway,
      log: (line) => console.log(line),
    });
    console.log(JSON.stringify({ sent: result.sent, heard: result.heard, mspt: result.mspt }));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
