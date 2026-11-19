import { describe, expect, it } from 'vitest';
import { PatrolProgram } from './patrol.ts';
import {
  contextFor,
  drive,
  expectResumeEverywhere,
  type FakeWorld,
  newWorld,
} from './programs.fakes.ts';

const TWO_POINTS = [
  { x: 10, y: 64, z: 0 },
  { x: 10, y: 64, z: 10 },
];
const factory = () => new PatrolProgram();

function gotos(world: FakeWorld): number {
  return world.log.filter((line) => line.startsWith('goto:')).length;
}

function points(count: number) {
  return Array.from({ length: count }, (_, i) => ({ x: i, y: 64, z: 0 }));
}

async function refused(args: Record<string, unknown>): Promise<void> {
  await expect(factory().start(args, contextFor(newWorld()))).rejects.toMatchObject({
    reason: 'invalid_args',
    program: 'patrol',
  });
}

describe('patrol arguments', () => {
  it('refuses an empty, one-point and nine-point route', async () => {
    await refused({ route: [] });
    await refused({ route: [TWO_POINTS[0]] });
    await refused({ route: points(9) });
  });

  it('refuses a missing, non-array or malformed route', async () => {
    await refused({});
    await refused({ route: 'x' });
    await refused({ route: [TWO_POINTS[0], { x: 1.5, y: 64, z: 0 }] });
    await refused({ route: [TWO_POINTS[0], null] });
  });

  it('refuses an unknown field', async () => {
    await refused({ route: TWO_POINTS, target: 'x' });
  });

  it('accepts two and eight points', async () => {
    await expect(
      factory().start({ route: TWO_POINTS }, contextFor(newWorld())),
    ).resolves.toBeUndefined();
    await expect(
      factory().start({ route: points(8) }, contextFor(newWorld())),
    ).resolves.toBeUndefined();
  });

  it('bounds laps at the limit and refuses laps without loop', async () => {
    await expect(
      factory().start({ route: TWO_POINTS, loop: true, laps: 20 }, contextFor(newWorld())),
    ).resolves.toBeUndefined();
    await refused({ route: TWO_POINTS, loop: true, laps: 21 });
    await refused({ route: TWO_POINTS, loop: true, laps: 0 });
    await refused({ route: TWO_POINTS, loop: false, laps: 2 });
    await refused({ route: TWO_POINTS, loop: 'yes' });
  });
});

describe('patrol run', () => {
  it('stops at laps: two laps of a loop make four walks and complete', async () => {
    const world = newWorld();
    const done = await drive(factory, { route: TWO_POINTS, loop: true, laps: 2 }, world);
    expect(done.last).toEqual({ status: 'completed', detail: { laps: 2, stopped: 'laps' } });
    expect(gotos(world)).toBe(4);
  });

  it('walks a route once without loop and completes', async () => {
    const world = newWorld();
    const done = await drive(factory, { route: TWO_POINTS }, world);
    expect(done.last).toEqual({ status: 'completed', detail: { laps: 1, stopped: 'laps' } });
    expect(gotos(world)).toBe(2);
  });

  it('resumes at every boundary with the same result and no repeated walk', async () => {
    const steps = await expectResumeEverywhere(
      factory,
      { route: TWO_POINTS, loop: true, laps: 2 },
      () => newWorld(),
    );
    expect(steps).toBeGreaterThan(1);
  });

  it('a cancelled leg leaves the program running at the same point', async () => {
    const abort = new AbortController();
    abort.abort();
    const world = newWorld();
    const ctx = contextFor(world, abort.signal);
    const program = factory();
    await program.start({ route: TWO_POINTS }, ctx);
    expect(await program.step(ctx)).toEqual({ status: 'running' });
    expect(program.checkpoint()).toMatchObject({ leg: 0, lapsDone: 0 });
    expect(gotos(world)).toBe(0);
  });

  it('a hostile nearby with low health ends with danger', async () => {
    const world = newWorld({
      health: 6,
      hostiles: [{ name: 'zombie', distance: 3, position: { x: 1, y: 64, z: 1 } }],
    });
    const done = await drive(factory, { route: TWO_POINTS, loop: true, laps: 2 }, world);
    expect(done.last).toEqual({ status: 'completed', detail: { laps: 0, stopped: 'danger' } });
    expect(gotos(world)).toBe(0);
  });

  it('a hostile nearby at good health keeps walking', async () => {
    const world = newWorld({
      hostiles: [{ name: 'zombie', distance: 3, position: { x: 1, y: 64, z: 1 } }],
    });
    const done = await drive(factory, { route: TWO_POINTS, loop: true, laps: 2 }, world);
    expect(done.last).toEqual({ status: 'completed', detail: { laps: 2, stopped: 'laps' } });
  });

  it('never attacks, even with a hostile in reach', async () => {
    const kinds: string[] = [];
    const world = newWorld({
      hostiles: [{ name: 'zombie', distance: 2, position: { x: 1, y: 64, z: 1 } }],
    });
    const ctx = contextFor(world);
    const run = ctx.runAction;
    ctx.runAction = (action, signal) => {
      kinds.push(action.do);
      return run(action, signal);
    };
    const program = factory();
    await program.start({ route: TWO_POINTS, loop: true, laps: 2 }, ctx);
    for (let i = 0; i < 20; i += 1) {
      const result = await program.step(ctx);
      if (result.status !== 'running') break;
    }
    expect(kinds).not.toContain('attack');
    expect(world.log.some((line) => line.includes('attack'))).toBe(false);
  });

  it('a blocked leg fails through stopOf and does not loop', async () => {
    const world = newWorld({ failing: { goto: 'blocked' } });
    const done = await drive(factory, { route: TWO_POINTS, loop: true, laps: 2 }, world);
    expect(done.last.status).toBe('failed');
    expect(done.last).toMatchObject({ message: expect.stringMatching(/^blocked:/) });
    // One step tried the leg and stopped: the failed goto is not logged, so the step count is the proof.
    expect(done.steps).toBe(1);
    expect(world.position).toEqual({ x: 0, y: 64, z: 0 });
  });
});
