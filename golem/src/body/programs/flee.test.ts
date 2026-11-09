import { describe, expect, it } from 'vitest';
import { FleeProgram } from './flee.ts';
import { contextFor, drive, expectResumeEverywhere, newWorld } from './programs.fakes.ts';

const make = () => new FleeProgram();

/** A zombie 3 blocks west of the origin. */
const zombie = { name: 'zombie', distance: 3, position: { x: -3, y: 64, z: 0 } };

describe('flee', () => {
  it('runs directly away from a hostile and is done once none is near', async () => {
    const run = await drive(
      make,
      { distance: 10 },
      newWorld({ hostiles: [zombie], escapeAfterGotos: 1 }),
    );
    expect(run.world.log).toEqual([`goto:${JSON.stringify({ x: 10, y: 64, z: 0 })}`]);
    expect(run.last).toEqual({ status: 'completed', detail: { legs: 1 } });
  });

  it('completes at once when nothing hostile is near', async () => {
    const run = await drive(make, {}, newWorld());
    expect(run.last).toEqual({ status: 'completed', detail: { legs: 0 } });
    expect(run.world.log).toEqual([]);
  });

  it('fails with blocked after max_legs legs with the hostile still near', async () => {
    const run = await drive(make, { max_legs: 2 }, newWorld({ hostiles: [zombie] }));
    expect(run.last).toEqual({
      status: 'failed',
      message: 'blocked: 1 hostile(s) still near after 2 legs',
    });
    expect(run.world.log).toHaveLength(2);
  });

  it('fails with the action reason when the goto fails', async () => {
    const run = await drive(
      make,
      {},
      newWorld({ hostiles: [zombie], failing: { goto: 'blocked' } }),
    );
    expect(run.last).toEqual({ status: 'failed', message: 'blocked: fake goto failure' });
  });

  it('rejects bad arguments with invalid_args', async () => {
    for (const args of [
      { distance: 7 },
      { distance: 65 },
      { max_legs: 0 },
      { distance: 'far' },
      { run: true },
    ]) {
      await expect(make().start(args, contextFor(newWorld()))).rejects.toMatchObject({
        reason: 'invalid_args',
      });
    }
  });

  it('resumes at every step boundary to the same end state', async () => {
    await expectResumeEverywhere(make, { distance: 10 }, () =>
      newWorld({ hostiles: [zombie], escapeAfterGotos: 3 }),
    );
  });
});
