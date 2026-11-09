import { beforeEach, describe, expect, it, vi } from 'vitest';
import { moveNear } from '../../actions/pathing.ts';
import { calmScene, sceneContext, sceneView, zombieAt } from './combat.fakes.ts';
import { retreatReflex } from './retreat.ts';

vi.mock('../../actions/pathing.ts', () => ({ moveNear: vi.fn() }));

const walk = vi.mocked(moveNear);

beforeEach(() => {
  walk.mockReset();
});

describe('retreat check', () => {
  it('fires at 6 health with a hostile within 5 blocks', () => {
    const scene = calmScene();
    scene.health = 6;
    scene.hostiles = [zombieAt(5)];
    expect(retreatReflex.check(sceneView(scene))).toMatchObject({
      health: 6,
      hostile: 'zombie',
      safe_spot: 'spawn',
    });
  });

  it('stays quiet at 7 health, with the hostile out of range, or with none', () => {
    const scene = calmScene();
    scene.hostiles = [zombieAt(3)];
    scene.health = 7;
    expect(retreatReflex.check(sceneView(scene))).toBeNull();
    scene.health = 4;
    scene.hostiles = [zombieAt(5.5)];
    expect(retreatReflex.check(sceneView(scene))).toBeNull();
    scene.hostiles = [];
    expect(retreatReflex.check(sceneView(scene))).toBeNull();
  });
});

describe('retreat run', () => {
  it('cancels the action, walks to the safe spot and raises a danger wake', async () => {
    const scene = calmScene();
    scene.health = 4;
    scene.hostiles = [zombieAt(2)];
    walk.mockResolvedValue({ ok: true, distance: 1 });
    const ctx = sceneContext(scene);
    const trigger = retreatReflex.check(ctx.view);
    if (trigger === null) throw new Error('retreat did not fire');

    const outcome = await retreatReflex.run(trigger, ctx);

    expect(outcome.result).toBe('handled');
    expect(ctx.cancelled()).toBe(1);
    expect(walk.mock.calls[0]?.[1]).toEqual({ x: 50.5, y: 64, z: 0.5 });
    expect(ctx.sink.wakes).toHaveLength(1);
    expect(ctx.sink.wakes[0]).toMatchObject({ reason: 'reflex_danger', tick: 100 });
  });

  it('still raises the wake when the walk fails', async () => {
    const scene = calmScene();
    scene.health = 4;
    scene.hostiles = [zombieAt(2)];
    walk.mockResolvedValue({ ok: false, reason: 'blocked', message: 'no path' });
    const ctx = sceneContext(scene);

    const outcome = await retreatReflex.run({ health: 4, hostile: 'zombie' }, ctx);

    expect(outcome).toEqual({ result: 'failed', detail: 'walk to the spawn ended: blocked' });
    expect(ctx.sink.wakes.map((w) => w.reason)).toEqual(['reflex_danger']);
  });

  it('abandons with a wake when no safe spot is known, without walking', async () => {
    const scene = calmScene();
    scene.health = 4;
    scene.safeSpot = null;
    const ctx = sceneContext(scene);

    const outcome = await retreatReflex.run({ health: 4, hostile: 'zombie' }, ctx);

    expect(outcome.result).toBe('abandoned');
    expect(walk).not.toHaveBeenCalled();
    expect(ctx.sink.wakes).toHaveLength(1);
  });
});
