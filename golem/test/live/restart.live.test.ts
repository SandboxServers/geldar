import { describe, expect, it } from 'vitest';
import type { BodyKv } from '../../src/body/checkpoint.ts';
import { derivedId } from '../../src/body/derived-id.ts';
import type { MemorySink } from '../../src/body/records.ts';
import { fakeKv } from '../../src/body/restart.fakes.ts';
import { openRestartKv, type RestartBodyOptions, restartBody } from '../../src/body/restart.ts';
import { type LiveContext, withLiveBot } from './fixture.ts';

/** Slot 2 of the arena (no other file uses it) and the bot that plays it. */
const NAME = 'GolemRestart';
const SLOT = 2;
/**
 * The life id and the intent id, unique per run: a checkpoint or generation left in a real NATS
 * by an earlier run cannot be mistaken for this run's. The keys are deleted when the test ends.
 */
const RUN = Date.now().toString(36);
const LIFE = `ag_restart_${RUN}`;
const INTENT = derivedId('in', `restart-live:${RUN}`);
const LOGS = 10;
const POLL_LIMIT = 4000;

/** The count `clear <name> <item> 0` reports; it removes nothing. */
function foundCount(reply: string): number {
  const match = /Found (\d+) matching item/.exec(reply);
  return match ? Number(match[1]) : 0;
}

/**
 * The two buckets: the shard's NATS when `GELDAR_NATS_URL` is set, memory otherwise. `puts` counts
 * the checkpoint writes so the test can wait for the first one; `close` deletes this run's keys.
 */
async function buckets(): Promise<{
  kv: RestartBodyOptions['kv'];
  puts(): number;
  close(): Promise<void>;
}> {
  const url = process.env.GELDAR_NATS_URL;
  const open = url
    ? await openRestartKv(url)
    : {
        kv: { generations: fakeKv(), checkpoints: fakeKv() } as {
          generations: BodyKv;
          checkpoints: BodyKv;
        },
        close: async () => undefined,
      };
  let puts = 0;
  const checkpoints: BodyKv = {
    ...open.kv.checkpoints,
    async put(key, value) {
      const revision = await open.kv.checkpoints.put(key, value);
      puts += 1;
      return revision;
    },
  };
  return {
    kv: { generations: open.kv.generations, checkpoints },
    puts: () => puts,
    async close() {
      for (const bucket of [open.kv.checkpoints, open.kv.generations]) {
        await bucket.delete(LIFE).catch(() => undefined);
      }
      await open.close();
    },
  };
}

/** Starts a Body for the life on the live bot, as the supervisor does after a crash. */
function startBody(live: LiveContext, kv: RestartBodyOptions['kv']) {
  return restartBody({
    lifeId: LIFE,
    bot: live.bot,
    ticks: live.manager.onWorldTick,
    currentRevision: () => 1,
    kv,
    noPlanWaitMs: 600_000,
  });
}

describe('a Body restart on a live server', () => {
  it('finishes a gather intent after the Body is torn down mid-run, with two generations on record', async () => {
    await withLiveBot({ name: NAME, slot: SLOT }, async (live) => {
      const { bot, ctl, arena } = live;
      const { x, y, z } = arena.center;
      await ctl.command(`kill @e[type=item,x=${x},y=${y},z=${z},distance=..40]`);
      await ctl.fill({ x: x + 3, y, z }, { x: x + 2 + LOGS, y, z }, 'oak_log');
      const open = await buckets();
      try {
        const first = await startBody(live, open.kv);
        const mind = {
          reasoning: 'collect logs',
          intent: {
            goal: 'collect_logs',
            program: 'gather',
            arguments: { block: 'oak_log', count: LOGS },
            wake_on: ['goal_completed'],
            limits: { max_world_ticks: 6000, max_block_operations: 100 },
          },
        };
        const accepted = await first.body.executor.submit(mind, {
          lifeId: LIFE,
          bodyGeneration: first.generation,
          snapshotRevision: 1,
          expiresTick: bot.time.age + 100_000,
          sourceSnapshotId: `sn_${'1'.padStart(26, '0')}`,
          intentId: INTENT,
          actionIds: [],
        });
        expect(accepted.intent).toBe('started');

        // Let it mine part of the column, then tear the Body down as a crash would.
        const held = (): number =>
          bot.inventory.items().find((i) => i.name === 'oak_log')?.count ?? 0;
        for (let i = 0; i < POLL_LIMIT && held() < 3; i++) await bot.waitForTicks(1);
        expect(held()).toBeGreaterThanOrEqual(3);
        // A teardown before the first checkpoint put would leave nothing to resume from.
        for (let i = 0; i < POLL_LIMIT && open.puts() < 1; i++) await bot.waitForTicks(1);
        expect(open.puts()).toBeGreaterThanOrEqual(1);
        await first.stop();
        const partial = held();
        expect(partial).toBeLessThan(LOGS);

        const second = await startBody(live, open.kv);
        expect(second.generation).toBe(first.generation + 1);
        expect(second.outcome).toEqual({ kind: 'resumed', intentId: INTENT });
        for (let i = 0; i < POLL_LIMIT && second.body.executor.intentId !== null; i++) {
          await bot.waitForTicks(1);
        }
        await second.stop();

        const records = [first, second].map((b) => b.body.records as MemorySink);
        const generations = new Set(records.flatMap((r) => r.intents.map((c) => c.bodyGeneration)));
        expect([...generations].sort()).toEqual([first.generation, second.generation]);
        expect(records[1]?.intents.at(-1)).toMatchObject({
          intentId: INTENT,
          state: 'completed',
        });
        expect(foundCount(await ctl.command(`clear ${NAME} oak_log 0`))).toBeGreaterThanOrEqual(
          LOGS,
        );
      } finally {
        await open.close();
      }
    });
  });
});
