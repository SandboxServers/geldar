import { describe, expect, it } from 'vitest';
import { GatherProgram } from './gather.ts';
import { contextFor, drive, expectResumeEverywhere, newWorld } from './programs.fakes.ts';

const make = () => new GatherProgram();

describe('gather', () => {
  it('mines in batches until the inventory holds the asked count more', async () => {
    const run = await drive(
      make,
      { block: 'oak_log', count: 20 },
      newWorld({ inventory: { oak_log: 3 } }),
    );
    expect(run.last).toEqual({ status: 'completed', detail: { item: 'oak_log', have: 23 } });
    expect(run.world.log).toEqual(['mine:oak_logx8', 'mine:oak_logx8', 'mine:oak_logx4']);
  });

  it('counts the dropped item when it differs from the block', async () => {
    const run = await drive(make, { block: 'stone', item: 'cobblestone', count: 5 }, newWorld());
    expect(run.last.status).toBe('completed');
    expect(run.world.inventory).toEqual({ cobblestone: 5 });
  });

  it('fails when mining adds nothing to the inventory', async () => {
    // The asked item is dirt, but stone drops cobblestone.
    const run = await drive(make, { block: 'stone', item: 'dirt', count: 2 }, newWorld());
    expect(run.last.status).toBe('failed');
  });

  it('takes the item from the registry drops when item is left out', async () => {
    const run = await drive(make, { block: 'stone', count: 5 }, newWorld());
    expect(run.last).toEqual({ status: 'completed', detail: { item: 'cobblestone', have: 5 } });
    expect(run.world.inventory).toEqual({ cobblestone: 5 });
  });

  it('accepts radius as a search bound and checkpoints it', async () => {
    const near = await drive(
      make,
      { block: 'oak_log', count: 2, radius: 10 },
      newWorld({ nearest: { oak_log: 6 } }),
    );
    expect(near.last.status).toBe('completed');
    const far = await drive(
      make,
      { block: 'oak_log', count: 2, radius: 10 },
      newWorld({ nearest: { oak_log: 40 } }),
    );
    expect(far.last).toEqual({ status: 'failed', message: 'not_found: no oak_log within 10' });
    const program = make();
    await program.start({ block: 'oak_log', count: 2, radius: 10 }, contextFor(newWorld()));
    expect(program.checkpoint()).toEqual({
      block: 'oak_log',
      item: 'oak_log',
      goal: 2,
      radius: 10,
    });
  });

  it('completes in the step that mines the last block', async () => {
    const world = newWorld();
    const ctx = contextFor(world);
    const program = make();
    await program.start({ block: 'oak_log', count: 3 }, ctx);
    expect(await program.step(ctx)).toEqual({
      status: 'completed',
      detail: { item: 'oak_log', have: 3 },
    });
  });

  it('fails with the action reason, or wakes the Mind for a missing tool', async () => {
    const lost = await drive(
      make,
      { block: 'oak_log', count: 2 },
      newWorld({ failing: { mine: 'not_found' } }),
    );
    expect(lost.last).toEqual({ status: 'failed', message: 'not_found: fake mine failure' });
    const tool = await drive(
      make,
      { block: 'iron_ore', count: 2 },
      newWorld({ failing: { mine: 'missing_materials' } }),
    );
    expect(tool.last).toMatchObject({ status: 'wake', reason: 'precondition_failed' });
  });

  it('resumes with the remaining count taken from the inventory', async () => {
    const world = newWorld();
    const ctx = contextFor(world);
    const first = make();
    await first.start({ block: 'oak_log', count: 20 }, ctx);
    await first.step(ctx);
    const saved = JSON.parse(JSON.stringify(first.checkpoint()));
    // The Body picked up 4 more logs while it was down.
    world.inventory.oak_log = (world.inventory.oak_log ?? 0) + 4;
    const second = make();
    await second.resume(saved, ctx);
    world.log.length = 0;
    await second.step(ctx);
    expect(world.log).toEqual(['mine:oak_logx8']);
    expect(saved).toEqual({ block: 'oak_log', item: 'oak_log', goal: 20 });
  });

  it('rejects bad arguments with invalid_args', async () => {
    for (const args of [
      {},
      { block: 'oak_log' },
      { block: 'oak_log', count: 0 },
      { block: 'Oak', count: 1 },
      { block: 'oak_log', count: 1.5 },
      { block: 'oak_log', count: 1, x: 1 },
    ]) {
      await expect(make().start(args, contextFor(newWorld()))).rejects.toMatchObject({
        reason: 'invalid_args',
      });
    }
  });

  it('resumes at every step boundary to the same end state', async () => {
    await expectResumeEverywhere(make, { block: 'oak_log', count: 20 }, () =>
      newWorld({ inventory: { oak_log: 3 } }),
    );
  });
});
