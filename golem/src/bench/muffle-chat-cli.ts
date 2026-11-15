/**
 * MH-8a muffle-chat entry point. Runs the multi-bot chat on a throwaway bench shard, or summarizes a
 * server log that holds `muffle-bench` lines. Not wired into bench/cli.ts: the scenario registry drives
 * one bot, and muffle-chat drives 9 or 15.
 *
 *   node --experimental-strip-types golem/src/bench/muffle-chat-cli.ts --bots 9 --speakers 3 --mode burst \
 *     --mc-port 26565 --rcon-port 26575 --nats-url nats://127.0.0.1:14222
 *   node --experimental-strip-types golem/src/bench/muffle-chat-cli.ts --summarize <log file>
 *
 * --summarize reads one run's log; restart the server between runs so tick numbers do not collide.
 * --speakers K (1 to 5, default 1: the control). --mode steady (default) or burst. See muffle-chat.ts.
 *
 * RCON whitelist/tp/fill here is a test-harness operator control on a throwaway bench shard only; it is
 * never used on a real shard. Principle 1 concerns the real world.
 */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { loadConfig } from '../config.ts';
import { parseMuffleLog, summarizeByTick, summarizeMuffle } from './muffle-log.ts';
import {
  assertThrowawayTarget,
  BENCH_SIZES,
  CHAT_MODES,
  type ChatMode,
  type Layout,
  muffleLayout,
  runMuffleChat,
  SPEAKER_ROWS,
  THROWAWAY_FLAG,
} from './scenarios/muffle-chat.ts';

const USAGE =
  'usage: muffle-chat-cli (--bots <9|15> [--speakers <1-5>] [--mode <steady|burst>] [--mc-port <n>] ' +
  `[--rcon-port <n>] [--nats-url <url>] [${THROWAWAY_FLAG}] | --summarize <log file>)`;

/** Printed with every summary: a burst's K lines can straddle a tick boundary, so `worst` alone misleads. */
const SUMMARY_NOTE =
  "A burst's K lines are sent in one turn but can arrive over a few ms, so a 50 ms tick boundary can split " +
  'one burst across two ticks. Read perTick.linesPerTick max and p95 together with worst; do not read worst ' +
  'alone as the burst cost.';

/** Runs the command and returns the exit code: 0 ok, 1 refused or failed, 2 bad usage. */
export async function main(argv: string[]): Promise<number> {
  let values: Record<string, string | boolean | undefined>;
  try {
    values = parseArgs({
      args: argv,
      allowPositionals: false,
      options: {
        bots: { type: 'string' },
        speakers: { type: 'string' },
        mode: { type: 'string' },
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
    console.log(
      JSON.stringify(
        {
          ...summarizeMuffle(records),
          perTick: summarizeByTick(records),
          note: SUMMARY_NOTE,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  const bots = Number(values.bots);
  if (!(BENCH_SIZES as readonly number[]).includes(bots)) {
    console.error(`--bots must be 9 or 15\n${USAGE}`);
    return 2;
  }
  const speakers = Number(values.speakers ?? 1);
  if (!Number.isInteger(speakers) || speakers < 1 || speakers > SPEAKER_ROWS.length) {
    console.error(`--speakers must be 1 to ${SPEAKER_ROWS.length}\n${USAGE}`);
    return 2;
  }
  const mode = (values.mode ?? 'steady') as string;
  if (!(CHAT_MODES as readonly string[]).includes(mode)) {
    console.error(`--mode must be steady or burst\n${USAGE}`);
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
  let layout: Layout;
  try {
    layout = muffleLayout(bots, speakers);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  for (const spot of layout.spots) {
    console.log(
      `${spot.name} ${spot.role} x=${spot.x} z=${spot.z} distance=${spot.distance} blocks=[${spot.blocks.join(', ')}]`,
    );
  }
  try {
    const result = await runMuffleChat({
      bots,
      speakers,
      mode: mode as ChatMode,
      cfg,
      throwawayFlag: throwaway,
      log: (line) => console.log(line),
    });
    console.log(
      JSON.stringify({
        speakers,
        mode,
        sent: result.sent,
        heard: result.heard,
        mspt: result.mspt,
      }),
    );
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
