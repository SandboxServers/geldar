import { describe, expect, it } from 'vitest';
import { contextFor, drive, expectResumeEverywhere, newWorld } from './programs.fakes.ts';
import { RestProgram } from './rest.ts';

const make = () => new RestProgram();

describe('rest', () => {
  it('sleeps at night and is done when health is back', async () => {
    const run = await drive(make, {}, newWorld({ night: true }));
    expect(run.last).toEqual({
      status: 'completed',
      detail: { health: 20, slept: true, waits: 0 },
    });
    expect(run.world.log).toEqual(['sleep']);
  });

  it('falls back to waiting by day, after one sleep attempt', async () => {
    const run = await drive(make, { until_health: 15, wait_seconds: 2 }, newWorld());
    expect(run.last).toMatchObject({ status: 'completed', detail: { slept: false, waits: 2 } });
    expect(run.world.log).toEqual(['sleep', 'wait:2', 'wait:2']);
  });

  it('fails with the action reason when a wait fails', async () => {
    const run = await drive(make, {}, newWorld({ failing: { wait: 'internal' } }));
    expect(run.last).toEqual({ status: 'failed', message: 'internal: fake wait failure' });
  });
  it('fails with timeout after max_waits', async () => {
    const run = await drive(make, { max_waits: 2, wait_seconds: 1 }, newWorld({ health: 1 }));
    expect(run.last).toEqual({ status: 'failed', message: 'timeout: health 7 below 20' });
  });

  it('is done at once when already healthy', async () => {
    const run = await drive(make, { until_health: 5 }, newWorld({ health: 9 }));
    expect(run.last.status).toBe('completed');
    expect(run.world.log).toEqual([]);
  });

  it('rejects bad arguments with invalid_args', async () => {
    for (const args of [
      { until_health: 0 },
      { until_health: 21 },
      { wait_seconds: 'x' },
      { max_waits: 1.5 },
      { other: 1 },
    ]) {
      await expect(make().start(args, contextFor(newWorld()))).rejects.toMatchObject({
        reason: 'invalid_args',
      });
    }
  });

  it('resumes at every step boundary to the same end state, by day and by night', async () => {
    await expectResumeEverywhere(make, { wait_seconds: 3 }, () => newWorld());
    await expectResumeEverywhere(make, { until_health: 20 }, () =>
      newWorld({ night: true, health: 4 }),
    );
  });
});
