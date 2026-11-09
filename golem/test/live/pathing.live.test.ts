import { describe, expect, it } from 'vitest';
import { moveNear } from '../../src/actions/pathing.ts';
import { withLiveBot } from './fixture.ts';

/**
 * Pathing on 26.1 in slot 0 (GolemSmoke). Evidence for the wall-clock and world-tick rules: a
 * short path resolves, a full wall blocks within 30 s, and an abort cancels within 2 s.
 */
describe('pathing: moveNear on 26.1', () => {
  it('walks 10 blocks to a goal near the target', async () => {
    await withLiveBot({ name: 'GolemSmoke', slot: 0 }, async ({ bot, arena }) => {
      const target = { x: arena.center.x + 10, y: arena.center.y, z: arena.center.z };
      const result = await moveNear(bot, target, 2, {
        signal: new AbortController().signal,
        timeScale: 1,
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.distance).toBeLessThanOrEqual(2.5);
    });
  }, 180_000);

  it('returns blocked within 30 s when a solid wall spans the platform', async () => {
    await withLiveBot({ name: 'GolemSmoke', slot: 0 }, async ({ bot, ctl, arena }) => {
      const cx = arena.center.x;
      const cy = arena.center.y;
      // A solid 4-high stone wall across the whole platform. The bot cannot dig and cannot jump it.
      const wallFrom = { x: cx + 5, y: cy, z: arena.min.z };
      const wallTo = { x: cx + 5, y: cy + 3, z: arena.max.z };
      await ctl.fill(wallFrom, wallTo, 'stone');
      try {
        const started = Date.now();
        const result = await moveNear(bot, { x: cx + 10, y: cy, z: arena.center.z }, 1, {
          signal: new AbortController().signal,
          timeScale: 1,
        });
        const elapsed = Date.now() - started;
        expect(result).toMatchObject({ ok: false, reason: 'blocked' });
        expect(elapsed).toBeLessThan(30_000);
      } finally {
        await ctl.fill(wallFrom, wallTo, 'air');
      }
    });
  }, 180_000);

  it('cancels within 2 s of an abort 500 ms into the walk', async () => {
    await withLiveBot({ name: 'GolemSmoke', slot: 0 }, async ({ bot, arena }) => {
      const controller = new AbortController();
      const target = { x: arena.center.x - 10, y: arena.center.y, z: arena.center.z };
      const pending = moveNear(bot, target, 1, { signal: controller.signal, timeScale: 1 });
      await new Promise((resolve) => setTimeout(resolve, 500));
      const abortedAt = Date.now();
      controller.abort();
      const result = await pending;
      expect(result).toMatchObject({ ok: false, reason: 'cancelled' });
      expect(Date.now() - abortedAt).toBeLessThan(2_000);
    });
  }, 180_000);
});
