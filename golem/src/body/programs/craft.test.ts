import { describe, expect, it } from 'vitest';
import { CraftProgram } from './craft.ts';
import { contextFor, drive, expectResumeEverywhere, newWorld } from './programs.fakes.ts';

const make = () => new CraftProgram();

describe('craft', () => {
  it('crafts in batches until the inventory holds the asked count more', async () => {
    const run = await drive(
      make,
      { item: 'stick', count: 20 },
      newWorld({ inventory: { stick: 1 } }),
    );
    expect(run.last).toEqual({ status: 'completed', detail: { item: 'stick', have: 21 } });
    expect(run.world.log).toEqual(['craft:stickx16', 'craft:stickx4']);
  });

  it('is done at once when the inventory already holds enough', async () => {
    const run = await drive(
      make,
      { item: 'stick', count: 2 },
      newWorld({ inventory: { stick: 0 } }),
    );
    expect(run.last.status).toBe('completed');
  });

  it('wakes the Mind when materials or the station are missing, fails otherwise', async () => {
    for (const reason of ['missing_materials', 'missing_station'] as const) {
      const run = await drive(
        make,
        { item: 'stick', count: 2 },
        newWorld({ failing: { craft: reason } }),
      );
      expect(run.last).toMatchObject({ status: 'wake', reason: 'precondition_failed' });
    }
    const run = await drive(
      make,
      { item: 'stick', count: 2 },
      newWorld({ failing: { craft: 'not_possible' } }),
    );
    expect(run.last).toEqual({ status: 'failed', message: 'not_possible: fake craft failure' });
  });

  it('resumes from the inventory, not from the count it asked for', async () => {
    const world = newWorld();
    const ctx = contextFor(world);
    const first = make();
    await first.start({ item: 'stick', count: 20 }, ctx);
    await first.step(ctx);
    const saved = JSON.parse(JSON.stringify(first.checkpoint()));
    const second = make();
    await second.resume(saved, ctx);
    await second.step(ctx);
    expect(world.log).toEqual(['craft:stickx16', 'craft:stickx4']);
  });

  it('rejects bad arguments with invalid_args', async () => {
    for (const args of [
      {},
      { item: 'stick' },
      { item: 'stick', count: 0 },
      { item: 'Stick', count: 1 },
      { item: 'stick', count: 1, y: 2 },
    ]) {
      await expect(make().start(args, contextFor(newWorld()))).rejects.toMatchObject({
        reason: 'invalid_args',
      });
    }
  });

  it('resumes at every step boundary to the same end state', async () => {
    await expectResumeEverywhere(make, { item: 'stick', count: 20 }, () =>
      newWorld({ inventory: { stick: 1 } }),
    );
  });
});
