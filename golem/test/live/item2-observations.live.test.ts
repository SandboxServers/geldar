/**
 * The item-2 live harness (decision 0391 item 5): a throwaway Body with `observations: true` watches a second
 * life gift and fight in its sight, and the observation events it publishes are checked; then the observer
 * mines one block and the producer's XP is read back from the sink. WRITTEN, NOT RUN.
 *
 * It reaches only what the `ITEM2_*` variables name (see `item2Target`): the Body, the actor and RCON are all
 * built from that target, never from `loadStackConfig` or the default shard file. With `GELDAR_ITEM2` unset the
 * whole suite is skipped; with it set and a refused target the suite throws the refusal. Break and take are not
 * set up here: they need blocks the observer owns (see AN-50c). Excluded from `check` and CI like every
 * `*.live.test.ts`. Never run it with `adam up` alive: it starts its own Body.
 */
import { connectNats } from '@geldar/contract/nats';
import { jetstream } from '@nats-io/jetstream';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { type AdamBodyEnv, startAdamBody } from '../../src/adam/adam-body.ts';
import { loadAdamConfig } from '../../src/adam/adam-config.ts';
import { managerAcquire } from '../../src/adam/main.ts';
import { arenaFor } from '../../src/arena.ts';
import { main as mineOnce } from '../../src/bench/sheet/life-cli.ts';
import { jetStreamPublisher } from '../../src/body/records-nats.ts';
import { openRestartKv } from '../../src/body/restart.ts';
import { readRconPassword } from '../../src/config.ts';
import { ConnectionManager } from '../../src/connection.ts';
import { natsRequestServer } from '../../src/mind-link/server.ts';
import { RconClient } from '../../src/rcon.ts';
import { registryFromConfig } from '../../src/registry.ts';
import { TestControl } from '../../src/test-control.ts';
import { CHATTER_LIFE_ID } from './chatter-bot.ts';
import { runWithBot } from './fixture.ts';
import {
  checkMine,
  checkRow,
  checkXp,
  configRefusal,
  item2Refusal,
  item2StackConfig,
  item2Target,
  MINE_BLOCK,
  type RowName,
  SETUP_ROWS,
  type SeenObservation,
  type XpReading,
} from './item2-harness.ts';

const SETTLE_MS = 8_000;
const SLOT = 12;
const enabled = process.env.GELDAR_IT === '1' && process.env.GELDAR_ITEM2 === '1';
const target = item2Target(process.env);

async function readXp(pool: pg.Pool, life: string, domain: string): Promise<XpReading> {
  const xp = await pool.query('SELECT xp FROM proficiency WHERE life_id=$1 AND domain=$2', [
    life,
    domain,
  ]);
  const ev = await pool.query(
    'SELECT evidence_key FROM xp_evidence WHERE life_id=$1 AND domain=$2',
    [life, domain],
  );
  return {
    xp: Number(xp.rows[0]?.xp ?? 0),
    evidence: ev.rows.map((r) => String(r.evidence_key)),
  };
}

describe.skipIf(!enabled)('item-2 observations on a throwaway shard', () => {
  it('observer sees gift and fight; the observer mines and the XP reaches the sink', async () => {
    const refusal = item2Refusal(target, process.env);
    if (refusal !== null) throw new Error(refusal);
    // The shard file is read by the target's own shard name; nothing else picks it.
    const config = await loadAdamConfig({ GELDAR_SHARD: target.shard });
    const configProblem = configRefusal(config, target);
    if (configProblem !== null) throw new Error(configProblem);
    const stack = item2StackConfig(target);

    const nc = await connectNats({
      servers: target.natsUrl,
      name: 'item2-harness',
      timeout: 5_000,
    });
    const restartKv = await openRestartKv(target.natsUrl, config.building);
    const seen: SeenObservation[] = [];
    const real = jetStreamPublisher(jetstream(nc));
    const env: AdamBodyEnv = {
      config,
      kv: restartKv.kv,
      // Keeps what the Body publishes and forwards it, so the sink sees the same events.
      publisher: {
        publish: async (subject, body, id) => {
          if (subject.endsWith('.observation')) seen.push(JSON.parse(body) as SeenObservation);
          return real.publish(subject, body, id);
        },
      },
      server: natsRequestServer(nc),
      owners: nc,
      observations: true,
      log: () => undefined,
    };
    const rcon = await RconClient.connect({
      host: stack.rconHost,
      port: stack.rconPort,
      password: await readRconPassword(stack),
    });
    const ctl = new TestControl(rcon);
    const observer = new ConnectionManager({
      host: stack.mcHost,
      port: stack.mcPort,
      username: config.lifeId,
      registry: registryFromConfig(stack),
    });
    const actorManager = new ConnectionManager({
      host: stack.mcHost,
      port: stack.mcPort,
      username: CHATTER_LIFE_ID,
      registry: registryFromConfig(stack),
    });
    const pool = new pg.Pool({ connectionString: target.pgUrl, max: 1 });
    let body: Awaited<ReturnType<typeof startAdamBody>> | undefined;
    try {
      await ctl.whitelistAdd(config.lifeId);
      body = await startAdamBody(env, await managerAcquire(observer)(new AbortController().signal));
      const before = await readXp(pool, config.lifeId, 'mining');
      await runWithBot(
        { ctl, manager: actorManager, close: async () => undefined },
        { name: CHATTER_LIFE_ID, slot: SLOT },
        async ({ bot: actor, arena }) => {
          // Both lives stand one block apart in the arena, in sight of each other.
          const { x, y, z } = arena.center;
          await ctl.tp(config.lifeId, x + 1, y + 1, z);
          await ctl.tp(CHATTER_LIFE_ID, x, y + 1, z);
          await actor.waitForTicks(20);
          const run: Record<string, () => Promise<void>> = {
            gift: async () => {
              await ctl.give(CHATTER_LIFE_ID, 'cobblestone', 1);
              await actor.waitForTicks(10);
              const item = actor.inventory.items()[0];
              if (item) await actor.toss(item.type, null, 1);
            },
            fight: async () => {
              await ctl.command(`summon zombie ${x + 2} ${y + 1} ${z}`);
              await actor.waitForTicks(10);
              const mob = actor.nearestEntity((e) => e.name === 'zombie');
              if (mob) actor.attack(mob);
            },
          };
          for (const row of SETUP_ROWS) {
            seen.length = 0;
            await (run[row] as () => Promise<void>)();
            await new Promise((r) => setTimeout(r, SETTLE_MS));
            const problems = checkRow(row as RowName, seen, config.lifeId, [
              config.lifeId,
              actor.username,
            ]);
            expect(problems, row).toEqual([]);
          }
        },
      );
      // One stone beside the observer, so the scripted mine has a block to take.
      const at = arenaFor(SLOT).center;
      await ctl.setblock(at.x + 1, at.y + 1, at.z + 1, MINE_BLOCK);
      // The producer step: the observer Body mines one block through the sheet driver's `mine-once`
      // (one scripted plan, no model), so the sink has an award to measure.
      const mined = await mineOnce(['mine-once', config.lifeId, MINE_BLOCK, '1'], {
        SHEET_SHARD: target.shard,
        SHEET_PROJECT: target.project,
        SHEET_NATS_URL: target.natsUrl,
      });
      expect(checkMine(mined)).toEqual([]);
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      const after = await readXp(pool, config.lifeId, 'mining');
      expect(checkXp(before, after)).toEqual([]);
    } finally {
      await body?.stop();
      await rcon.close().catch(() => undefined);
      await ctl.whitelistRemove(config.lifeId).catch(() => undefined);
      await pool.end();
      await observer.stop();
      await restartKv.close();
      await nc.close();
    }
  });
});
