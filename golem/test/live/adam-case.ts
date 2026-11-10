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
  type ActionRow,
  ADAM_LIFE_ID,
  AdamStack,
  actionsOf,
  adamProcessSpecs,
  describeActions,
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

/** The live cases that run through `withAdamCase`; each one starts from the world it needs. */
export type AdamCaseKind = 'smoke' | 'chatter' | 'restart' | 'sleep';

/**
 * The time of day a case starts at. Only the sleep case starts at night: a day case has no night
 * to sleep through, and the night makes the 8B reach for the bed it is holding.
 */
export function caseTime(kind: AdamCaseKind): ResetTime {
  return kind === 'sleep' ? 'night' : 'day';
}

/**
 * The control commands a case runs once Adam's Body is up (`give` needs him online): the time of
 * day (`resetBot` sets it too, so the repeat is harmless), then an empty inventory. Only the sleep
 * case gives him a bed; a bed in the hands of any other case invites a `place` that fails.
 */
export function caseSetup(kind: AdamCaseKind): string[] {
  const commands = [`time set ${caseTime(kind)}`, `clear ${ADAM_LIFE_ID}`];
  if (kind === 'sleep') commands.push(`give ${ADAM_LIFE_ID} white_bed 1`);
  return commands;
}

/** The item ids in a `data get entity <name> Inventory` reply (`minecraft:` stripped), in reply order. */
export function inventoryItems(reply: string): string[] {
  return [...reply.matchAll(/id:\s*"minecraft:([a-z_]+)"/g)].map((m) => m[1] ?? '');
}

/**
 * Throws unless the inventory reply holds exactly the items the case's `caseSetup` gives: none for
 * every case but sleep, which holds one bed. A reply that is not an inventory is a failed read.
 */
export function checkCaseInventory(kind: AdamCaseKind, reply: string): void {
  if (!reply.includes('has the following entity data')) {
    throw new Error(`could not read ${ADAM_LIFE_ID}'s inventory: ${reply.trim()}`);
  }
  const expected = kind === 'sleep' ? ['white_bed'] : [];
  const found = inventoryItems(reply);
  const same = found.length === expected.length && found.every((item, i) => item === expected[i]);
  if (!same) {
    throw new Error(
      `the ${kind} case set up Adam's inventory wrong before the Mind started: ` +
        `holds [${found.join(', ') || 'nothing'}], expected [${expected.join(', ') || 'nothing'}]`,
    );
  }
}

/**
 * An accepted plan in the case: `via` is `intent` when the Body recorded an intent made from a valid
 * thought (`id` is that thought), `action` when an action of the case completed (`id` is the action).
 */
export interface PlanEvidence {
  via: 'intent' | 'action';
  id: string;
  state: string;
}

/**
 * The first accepted plan, two tiers: an intent row made from a valid thought (any state: the Body
 * accepted it), or else a completed action of the case while the case has a valid thought. An
 * action row carries no thought id, so the second tier needs a valid thought to exist, not which one
 * planned it. Returns null while neither tier has appeared.
 */
export function planEvidence(
  thoughts: ThoughtRow[],
  intents: IntentRow[],
  actions: ActionRow[],
): PlanEvidence | null {
  const good = new Set(thoughts.filter((t) => t.valid).map((t) => t.thought_id));
  if (good.size === 0) return null;
  const made = intents.find((i) => i.thought_id !== null && good.has(i.thought_id));
  if (made) return { via: 'intent', id: made.thought_id ?? '', state: made.state };
  const done = actions.find((a) => a.state === 'completed');
  if (done) return { via: 'action', id: done.action_id, state: done.state };
  return null;
}

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
  /** The actions the case's life recorded after the case began, as `intents()` filters them. */
  actions(): Promise<ActionRow[]>;
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
 * the case's kind needs); Adam is whitelisted; then the Body starts, and before the Mind starts the
 * kind's `caseSetup` commands run (empty his inventory, give the sleep case its bed), Adam is moved
 * into the arena, and his inventory is read back and must hold exactly the case's items. Only then
 * do animus and lantern-local start, so the Mind's first look sees the case's world. Everything is
 * stopped and restored afterwards, even on failure. The chatter starts silent: a case that needs it
 * to speak calls `ac.chatter.speak()` once Adam has acted.
 */
export async function withAdamCase(
  opts: { slot: number; kind: AdamCaseKind },
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
      const restore = await resetBot(live.bot, live.ctl, { time: caseTime(opts.kind) });
      const db = await openMindDb();
      // Before the Mind starts: the 8B reads its own journal into every prompt (see adam-reset.ts).
      await resetJournal(db, ADAM_LIFE_ID);
      const since = new Date().toISOString();
      // The life persists between runs: intents and actions from earlier runs are not this case's.
      const older = new Set((await intentsOf(db, ADAM_LIFE_ID)).map((i) => i.intent_id));
      const olderActions = new Set((await actionsOf(db, ADAM_LIFE_ID)).map((a) => a.action_id));
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
        actions: async () =>
          (await actionsOf(db, ADAM_LIFE_ID)).filter((a) => !olderActions.has(a.action_id)),
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
            `actions: ${describeActions((await actionsOf(db, ADAM_LIFE_ID)).filter((a) => !olderActions.has(a.action_id)))}`,
            `chatter: ${chatter.describe()}`,
            stack.logs(),
          ].join('\n'),
      };
      try {
        // The Body, then the case's world, then the Mind: the Mind's first thought sees the setup.
        await stack.start(120_000, async () => {
          for (const command of caseSetup(opts.kind)) await live.ctl.command(command);
          const { x, y, z } = live.arena.center;
          await live.ctl.tp(ADAM_LIFE_ID, x + 1, y + 1, z + 1);
          const reply = await live.ctl.command(`data get entity ${ADAM_LIFE_ID} Inventory`);
          checkCaseInventory(opts.kind, reply);
        });
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
