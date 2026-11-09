import { validateSnapshot } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import type { ConnectionManager } from '../../src/connection.ts';
import { buildSnapshot } from '../../src/snapshot.ts';
import { stackVersions } from '../../src/versions.ts';
import { withLiveBot } from './fixture.ts';

const { pathfinder, Movements, goals } = pathfinderPkg;

/** Rejects if `p` does not settle within `ms`; the timer is cleared either way. */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms} ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Resolves with the next spawn of the manager's bot, or rejects after `ms`. */
function nextSpawn(manager: ConnectionManager, ms: number): Promise<Bot> {
  return withTimeout(new Promise<Bot>((resolve) => manager.once('spawn', resolve)), ms, 'spawn');
}

describe('smoke: one bot through the Velocity ingress', () => {
  it('joins 26.1, builds a valid snapshot, paths, reconnects and idles', async () => {
    await withLiveBot({ name: 'GolemSmoke', slot: 0 }, async ({ bot, ctl, arena, manager }) => {
      const verdict: Record<string, unknown> = { stack: stackVersions() };

      // (1) The bot joins through 127.0.0.1:25565 and reports a finite position on 26.1.
      const pos = bot.entity.position;
      expect(Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z)).toBe(true);
      expect(bot.version.startsWith('26.1')).toBe(true);
      expect(String(bot.protocolVersion)).toBe('775');
      verdict.version = bot.version;
      verdict.protocolVersion = String(bot.protocolVersion);
      verdict.worldAge = bot.time.age;
      verdict.timeOfDay = bot.time.timeOfDay;

      // (2) The snapshot passes the contract and the inventory is empty after `clear`.
      const snap = buildSnapshot(bot, { lifeId: 'ag_smoke_01', shard: 'phase0', revision: 1 });
      expect(validateSnapshot(snap).ok).toBe(true);
      expect(snap.self.inventory).toEqual([]);

      // (3) Pathfinder: the first evidence on 26.1. A goal six blocks east of the arena center.
      const goalX = arena.center.x + 6;
      const goalZ = arena.center.z;
      bot.loadPlugin(pathfinder);
      bot.pathfinder.setMovements(new Movements(bot));
      const started = Date.now();
      try {
        await withTimeout(
          bot.pathfinder.goto(new goals.GoalNear(goalX, arena.center.y, goalZ, 1)),
          30_000,
          'pathfinder goto',
        );
      } catch (err) {
        bot.pathfinder.stop();
        verdict.pathfinder = { ok: false, error: String(err) };
        throw err;
      }
      const distance = bot.entity.position.distanceTo(new Vec3(goalX, arena.center.y, goalZ));
      verdict.pathfinder = {
        ok: distance <= 2,
        ms: Date.now() - started,
        distance: Number(distance.toFixed(2)),
      };
      expect(distance).toBeLessThanOrEqual(2);

      // (4) Reconnect: a kick brings a disconnect, then a fresh spawn within 60 s.
      const disconnected = withTimeout(
        new Promise<unknown>((resolve) => manager.once('disconnect', resolve)),
        60_000,
        'disconnect after kick',
      );
      const respawned = nextSpawn(manager, 60_000);
      await ctl.command('kick GolemSmoke');
      await disconnected;
      const newBot = await respawned;
      expect([0, 1]).toContain(manager.attempt);
      expect(manager.bot).toBe(newBot);
      verdict.reconnectAttempt = manager.attempt;

      // (5) Idle for 20 s on the new bot: no `error` and no `kicked`.
      const errors: unknown[] = [];
      const kicks: unknown[] = [];
      newBot.on('error', (err) => {
        errors.push(err);
      });
      newBot.on('kicked', (reason) => {
        kicks.push(reason);
      });
      await new Promise((resolve) => setTimeout(resolve, 20_000));
      expect(errors).toEqual([]);
      expect(kicks).toEqual([]);
      expect(manager.state).toBe('online');
      verdict.idle = { seconds: 20, errors: errors.length, kicks: kicks.length };

      console.log(`PROTOCOL VERDICT ${JSON.stringify(verdict, null, 2)}`);
    });
  }, 180_000);
});
