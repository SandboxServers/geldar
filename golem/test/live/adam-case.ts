/**
 * The scaffold of the Mind live cases (P0-33b): the chatter test life joins the arena through the
 * standard fixture, Adam's three host processes are started on the 8B life, and the case gets the
 * database, the chatter and a `state()` text that every failure message prints (diagnostics first).
 * Written, not run here: it needs the shard, Postgres, NATS and Ollama (`GELDAR_IT=1 GELDAR_OLLAMA=1`).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { type AdamConfig, loadAdamConfig } from '../../src/adam/adam-config.ts';
import { repoRoot } from '../../src/config.ts';
import { resetJournal } from './adam-reset.ts';
import {
  ADAM_LIFE_ID,
  AdamStack,
  adamProcessSpecs,
  describeIntents,
  describeThoughts,
  type IntentRow,
  intentsOf,
  type MindDb,
  openMindDb,
  pollUntil,
  type ThoughtRow,
  thoughtsSince,
} from './adam-stack.ts';
import { type ChatterBot, withChatterBot } from './chatter-bot.ts';
import { type LiveContext, type ResetTime, resetBot } from './fixture.ts';

/** What a Mind live case gets. */
export interface AdamCase {
  live: LiveContext;
  chatter: ChatterBot;
  stack: AdamStack;
  db: MindDb;
  config: AdamConfig;
  /** When the case began; thoughts before it are not the case's. */
  since: string;
  thoughts(withInput?: boolean): Promise<ThoughtRow[]>;
  intents(): Promise<IntentRow[]>;
  /** The state seen so far, for the message of every failed assertion. */
  state(): Promise<string>;
  /**
   * Polls `probe` every `intervalMs` (a second by default) until it gives a value; a timeout prints
   * the state seen.
   */
  waitFor<T>(
    what: string,
    timeoutMs: number,
    probe: () => Promise<T | null | undefined | false>,
    intervalMs?: number,
  ): Promise<T>;
}

/** Throws unless the shard file is set up for the 8B life of decision 0051. */
export async function checkEightBillionLife(config: AdamConfig): Promise<void> {
  const file = join(repoRoot(), 'shards', 'phase0.yaml');
  const doc = parse(await readFile(file, 'utf8')) as {
    mind?: { run_tier?: string; agent?: { tier?: string } };
  };
  const problems: string[] = [];
  if (config.lifeId !== ADAM_LIFE_ID) {
    problems.push(`mind.agent.username is '${config.lifeId}', the 8B life is '${ADAM_LIFE_ID}'`);
  }
  if (doc.mind?.run_tier !== 'fast') problems.push(`mind.run_tier is '${doc.mind?.run_tier}'`);
  if (doc.mind?.agent?.tier !== 'fast')
    problems.push(`mind.agent.tier is '${doc.mind?.agent?.tier}'`);
  if (problems.length > 0) {
    throw new Error(
      `shards/phase0.yaml is not set for the 8B run (decision 0051): ${problems.join('; ')}. ` +
        `Run \`./geldar.ps1 adam select --model fast\` (life ${ADAM_LIFE_ID}, fast tier, qwen3:8b) on a fresh world volume.`,
    );
  }
}

/**
 * Runs `fn` with Adam's stack up. The world is reset the standard way (`resetBot`, with the time
 * the case needs); the chatter and Adam are whitelisted, Adam is moved into the arena once his Body
 * is up, and everything is stopped and restored afterwards, even on failure. The chatter starts
 * silent: a case that needs it to speak calls `ac.chatter.speak()` once Adam has acted.
 */
export async function withAdamCase(
  opts: { slot: number; time?: ResetTime },
  fn: (ac: AdamCase) => Promise<void>,
): Promise<void> {
  const config = await loadAdamConfig();
  await checkEightBillionLife(config);
  await withChatterBot(
    {
      slot: opts.slot,
      rateLimitSeconds: config.rateLimitSeconds,
      maxChars: config.maxChars,
      // Silent until the case calls `chatter.speak()`, so the chatter never greets Adam before he acts.
      silent: true,
    },
    async (chatter, live) => {
      const restore = await resetBot(live.bot, live.ctl, { time: opts.time ?? 'noon' });
      const db = await openMindDb();
      // Before the Mind starts: the 8B reads its own journal into every prompt (see adam-reset.ts).
      await resetJournal(db, ADAM_LIFE_ID);
      const since = new Date().toISOString();
      // The life persists between runs: intents from earlier runs are not this case's.
      const older = new Set((await intentsOf(db, ADAM_LIFE_ID)).map((i) => i.intent_id));
      const stack = new AdamStack(adamProcessSpecs(repoRoot(), process.env));
      await live.ctl.whitelistAdd(ADAM_LIFE_ID);
      const ac: AdamCase = {
        live,
        chatter,
        stack,
        db,
        config,
        since,
        thoughts: (withInput = false) => thoughtsSince(db, ADAM_LIFE_ID, since, withInput),
        intents: async () =>
          (await intentsOf(db, ADAM_LIFE_ID)).filter((i) => !older.has(i.intent_id)),
        waitFor: (what, timeoutMs, probe, intervalMs = 1_000) => {
          let seen = '(not polled yet)';
          return pollUntil(
            async () => {
              const value = await probe();
              if (value === null || value === undefined || value === false) seen = await ac.state();
              return value;
            },
            { what, timeoutMs, intervalMs, seen: () => seen },
          );
        },
        state: async () =>
          [
            `thoughts: ${describeThoughts(await thoughtsSince(db, ADAM_LIFE_ID, since))}`,
            `intents: ${describeIntents((await intentsOf(db, ADAM_LIFE_ID)).filter((i) => !older.has(i.intent_id)))}`,
            `chatter: ${chatter.describe()}`,
            stack.logs(),
          ].join('\n'),
      };
      try {
        await stack.start();
        const { x, y, z } = live.arena.center;
        await live.ctl.tp(ADAM_LIFE_ID, x + 1, y + 1, z + 1);
        await fn(ac);
      } finally {
        await stack.stop();
        await db.close().catch(() => undefined);
        await live.ctl.whitelistRemove(ADAM_LIFE_ID).catch(() => undefined);
        await restore();
      }
    },
  );
}
