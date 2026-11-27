/**
 * The item-2 live harness (decision 0391 item 5): a throwaway Body with `observations: true` watches a
 * second life break, gift, take and fight, and the observation events it publishes are checked, then the
 * producer's XP is read back from the sink. WRITTEN, NOT RUN. It needs a throwaway stack
 * (`bench/sheet/run.sh up`), `GELDAR_IT=1 GELDAR_ITEM2=1`, and the four ITEM2_* variables below, which have
 * no defaults, so an unset run refuses. Excluded from `check` and CI like every `*.live.test.ts`.
 * Never run it with `adam up` alive: it starts its own Body.
 */
import { connectNats } from '@geldar/contract/nats';
import { jetstream } from '@nats-io/jetstream';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { type AdamBodyEnv, startAdamBody } from '../../src/adam/adam-body.ts';
import { loadAdamConfig } from '../../src/adam/adam-config.ts';
import { managerAcquire } from '../../src/adam/main.ts';
import { main as mineOnce } from '../../src/bench/sheet/life-cli.ts';
import { jetStreamPublisher } from '../../src/body/records-nats.ts';
import { openRestartKv } from '../../src/body/restart.ts';
import { loadStackConfig } from '../../src/config.ts';
import { ConnectionManager } from '../../src/connection.ts';
import { natsRequestServer } from '../../src/mind-link/server.ts';
import { registryFromConfig } from '../../src/registry.ts';
import { withChatterBot } from './chatter-bot.ts';
import {
  checkMine,
  checkRow,
  checkXp,
  item2Refusal,
  MINE_BLOCK,
  ROWS,
  type RowName,
  type SeenObservation,
  type XpReading,
} from './item2-harness.ts';

const target = {
  shard: process.env.ITEM2_SHARD ?? '',
  project: process.env.ITEM2_PROJECT ?? '',
  natsUrl: process.env.ITEM2_NATS_URL ?? '',
  pgUrl: process.env.ITEM2_PG_URL ?? '',
};
const refusal = process.env.GELDAR_IT === '1' ? item2Refusal(target, process.env) : 'skipped';
const SETTLE_MS = 8_000;

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

describe.skipIf(refusal === 'skipped')('item-2 observations on a throwaway shard', () => {
  it('refuses a target that is not a throwaway shard', () => {
    expect(refusal, 'the harness refused its target').toBeNull();
  });

  it.skipIf(refusal !== null)(
    'observer sees break, gift, take and fight; the XP reaches the sink',
    async () => {
      const config = { ...(await loadAdamConfig()), shard: target.shard };
      const stack = loadStackConfig();
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
      const manager = new ConnectionManager({
        host: stack.mcHost,
        port: stack.mcPort,
        username: config.lifeId,
        registry: registryFromConfig(stack),
      });
      const pool = new pg.Pool({ connectionString: target.pgUrl, max: 1 });
      try {
        const body = await startAdamBody(
          env,
          await managerAcquire(manager)(new AbortController().signal),
        );
        const before = await readXp(pool, config.lifeId, 'mining');
        await withChatterBot(
          { slot: 11, rateLimitSeconds: 7, maxChars: 111, silent: true },
          async (_c, live) => {
            const actor = live.bot;
            const names = new Set<string>();
            const run: Record<RowName, () => Promise<void>> = {
              break: async () => {
                const block = actor.findBlock({
                  matching: (b) => b.name === 'dirt',
                  maxDistance: 5,
                });
                if (block) await actor.dig(block);
              },
              gift: async () => {
                const item = actor.inventory.items()[0];
                if (item) await actor.toss(item.type, null, 1);
              },
              take: async () => {
                const chest = actor.findBlock({
                  matching: (b) => b.name === 'chest',
                  maxDistance: 5,
                });
                if (chest) await (await actor.openContainer(chest)).close();
              },
              fight: async () => {
                const mob = actor.nearestEntity((e) => e.type === 'hostile' || e.type === 'mob');
                if (mob) actor.attack(mob);
              },
            };
            for (const { row } of ROWS) {
              seen.length = 0;
              await run[row]();
              await new Promise((r) => setTimeout(r, SETTLE_MS));
              names.add(row);
              expect(
                checkRow(row, seen, config.lifeId, [config.lifeId, actor.username]),
                row,
              ).toEqual([]);
            }
          },
        );
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
        await body.stop();
      } finally {
        await pool.end();
        await manager.stop();
        await restartKv.close();
        await nc.close();
      }
    },
  );
});
