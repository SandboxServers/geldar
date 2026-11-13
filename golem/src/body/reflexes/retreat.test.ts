import type { Vec3 } from 'vec3';
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

describe('retreat never walks into a canopy', () => {
  const leavesAt = (cells: string[]) => (p: Vec3) =>
    cells.includes(`${p.x},${p.y},${p.z}`)
      ? { name: 'oak_leaves', boundingBox: 'block' }
      : p.y <= 63
        ? { name: 'stone', boundingBox: 'block' }
        : { name: 'air', boundingBox: 'empty' };

  it('walks to the nearest bare ground when the spawn stands on leaves', async () => {
    const scene = calmScene();
    scene.health = 4;
    scene.hostiles = [zombieAt(2)];
    walk.mockResolvedValue({ ok: true, distance: 1 });
    const ctx = sceneContext(scene);
    Object.assign(ctx.bot, { blockAt: leavesAt(['50,63,0']) });
    const trigger = retreatReflex.check(ctx.view);
    if (trigger === null) throw new Error('retreat did not fire');

    const outcome = await retreatReflex.run(trigger, ctx);

    expect(outcome.result).toBe('handled');
    expect(walk.mock.calls[0]?.[1]).toEqual({ x: 49.5, y: 64, z: 0.5 });
  });

  it('stays to fight and still raises the wake when no solid ground is near the spawn', async () => {
    const scene = calmScene();
    scene.health = 4;
    scene.hostiles = [zombieAt(2)];
    const ctx = sceneContext(scene);
    Object.assign(ctx.bot, {
      blockAt: () => ({ name: 'oak_leaves', boundingBox: 'block' }),
    });
    const trigger = retreatReflex.check(ctx.view);
    if (trigger === null) throw new Error('retreat did not fire');

    const outcome = await retreatReflex.run(trigger, ctx);

    expect(walk).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      result: 'abandoned',
      detail: 'no solid ground near the spawn: staying to fight',
    });
    expect(ctx.sink.wakes).toHaveLength(1);
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

describe('retreat: who counts as a danger', () => {
  it('ignores a neutral mob close by', () => {
    const scene = calmScene();
    scene.health = 4;
    scene.hostiles = [zombieAt(2, 'enderman')];
    expect(retreatReflex.check(sceneView(scene))).toBeNull();
    scene.hostiles = [zombieAt(2, 'enderman'), zombieAt(4)];
    expect(retreatReflex.check(sceneView(scene))).toMatchObject({ hostile: 'zombie' });
  });
});

describe('retreat: a walk never digs (decision 0164)', () => {
  it('walks to the safe spot with digTier false', async () => {
    const scene = calmScene();
    scene.health = 4;
    scene.hostiles = [zombieAt(2)];
    walk.mockResolvedValue({ ok: true, distance: 1 });
    await retreatReflex.run(
      { health: 4, hostile: 'zombie' },
      sceneContext(scene, { timeScale: 1 }),
    );
    expect(walk.mock.calls[0]?.[3]).toMatchObject({ digTier: false });
  });
});

describe('retreat: time scale', () => {
  it('passes the runtime time scale to the walk', async () => {
    const scene = calmScene();
    scene.health = 4;
    scene.hostiles = [zombieAt(2)];
    walk.mockResolvedValue({ ok: true, distance: 1 });
    await retreatReflex.run(
      { health: 4, hostile: 'zombie' },
      sceneContext(scene, { timeScale: 3 }),
    );
    expect(walk.mock.calls[0]?.[3]).toMatchObject({ timeScale: 3 });
  });
});
