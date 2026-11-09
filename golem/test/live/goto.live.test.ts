import { validateActionRecord } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../src/actions/index.ts';
import { runAction } from '../../src/actions/registry.ts';
import type { Arena } from '../../src/arena.ts';
import type { TestControl } from '../../src/test-control.ts';
import { withLiveBot } from './fixture.ts';
import { recordFor } from './record.ts';

/** `goto` on 26.1 in slot 1 (GolemMove): a short walk, an unknown player, and a blocked wall. */
const NAME = 'GolemMove';
const SLOT = 1;

/** Removes item entities left by an earlier case in this arena (they are not blocks). */
async function clearDrops(ctl: TestControl, arena: Arena): Promise<void> {
  const { x, y, z } = arena.center;
  await ctl.command(`kill @e[type=item,x=${x},y=${y},z=${z},distance=..40]`);
}

describe('goto on 26.1', () => {
  it('completes a 12-block walk with a record that validates', async () => {
    await withLiveBot({ name: NAME, slot: SLOT }, async ({ bot, ctl, arena }) => {
      await clearDrops(ctl, arena);
      const target = { x: arena.center.x + 12, y: arena.center.y, z: arena.center.z };
      const run = await runAction(createRegistry(), bot, { do: 'goto', target });

      expect(run.state).toBe('completed');
      expect(Number(run.result.detail.distance)).toBeLessThanOrEqual(1.5);
      expect(run.result.world_ticks).toBeGreaterThan(0);
      expect(validateActionRecord(recordFor('goto', { target }, run)).ok).toBe(true);
    });
  }, 180_000);

  it('fails not_found for a player nobody can see, with a valid record', async () => {
    await withLiveBot({ name: NAME, slot: SLOT }, async ({ bot, ctl, arena }) => {
      await clearDrops(ctl, arena);
      const run = await runAction(createRegistry(), bot, { do: 'goto', target: 'NoSuchPlayer' });

      expect(run.state).toBe('failed');
      expect(run.result).toMatchObject({ status: 'failed', reason: 'not_found' });
      expect(validateActionRecord(recordFor('goto', { target: 'NoSuchPlayer' }, run)).ok).toBe(
        true,
      );
    });
  }, 180_000);

  it('fails blocked within 30 s when a full-width wall stands in the way', async () => {
    await withLiveBot({ name: NAME, slot: SLOT }, async ({ bot, ctl, arena }) => {
      await clearDrops(ctl, arena);
      const cx = arena.center.x;
      const cy = arena.center.y;
      // Stone across the whole platform, 4 high, between the bot and the target.
      const wallFrom = { x: cx + 5, y: cy, z: arena.min.z };
      const wallTo = { x: cx + 5, y: cy + 3, z: arena.max.z };
      await ctl.fill(wallFrom, wallTo, 'stone');
      try {
        const started = Date.now();
        const target = { x: cx + 10, y: cy, z: arena.center.z };
        const run = await runAction(createRegistry(), bot, { do: 'goto', target });

        expect(run.result).toMatchObject({ status: 'failed', reason: 'blocked' });
        expect(Date.now() - started).toBeLessThan(30_000);
        expect(validateActionRecord(recordFor('goto', { target }, run)).ok).toBe(true);
      } finally {
        await ctl.fill(wallFrom, wallTo, 'air');
      }
    });
  }, 180_000);
});
