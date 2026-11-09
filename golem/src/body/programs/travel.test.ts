import { describe, expect, it } from 'vitest';
import { ProgramError } from './args.ts';
import { contextFor, drive, expectResumeEverywhere, newWorld } from './programs.fakes.ts';
import { TravelProgram } from './travel.ts';

const make = () => new TravelProgram();
const target = { x: 10, y: 64, z: -5 };

describe('travel', () => {
  it('walks to a position and completes once the feet are there', async () => {
    const run = await drive(make, { target }, newWorld());
    expect(run.last.status).toBe('completed');
    expect(run.world.position).toEqual(target);
    expect(run.world.log).toEqual([`goto:${JSON.stringify(target)}`]);
  });

  it('completes a player trip when the goto completes', async () => {
    const run = await drive(make, { target: 'Alice' }, newWorld());
    expect(run.last).toEqual({ status: 'completed', detail: { player: 'Alice' } });
  });

  it('is already done when the Body stands at the target', async () => {
    const run = await drive(make, { target }, newWorld({ position: { ...target } }));
    expect(run.last.status).toBe('completed');
    expect(run.world.log).toEqual([]);
  });

  it('fails with the action reason when the goto fails', async () => {
    const run = await drive(make, { target }, newWorld({ failing: { goto: 'blocked' } }));
    expect(run.last).toEqual({ status: 'failed', message: 'blocked: fake goto failure' });
  });

  it('gives up after three legs that never arrive', async () => {
    const run = await drive(make, { target }, newWorld({ pinned: true }));
    expect(run.last).toEqual({
      status: 'failed',
      message: 'blocked: not at the target after 3 legs',
    });
    expect(run.world.log).toHaveLength(3);
  });
  it('rejects bad arguments with invalid_args', async () => {
    for (const args of [{}, { target: { x: 1, y: 2 } }, { target: 'a' }, { target, extra: 1 }]) {
      await expect(make().start(args, contextFor(newWorld()))).rejects.toMatchObject({
        reason: 'invalid_args',
      });
    }
    await expect(make().start({}, contextFor(newWorld()))).rejects.toBeInstanceOf(ProgramError);
  });

  it('resumes at every step boundary to the same end state', async () => {
    await expectResumeEverywhere(make, { target }, () => newWorld());
  });
});
