import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelled, completed } from '../../actions/outcome.ts';
import { moveNear } from '../../actions/pathing.ts';
import type { ActionHandler } from '../../actions/registry.ts';
import { type CombatScene, calmScene, sceneContext, sceneView, zombieAt } from './combat.fakes.ts';
import { fightOrFleeReflex } from './fight-or-flee.ts';

vi.mock('../../actions/pathing.ts', () => ({ moveNear: vi.fn() }));

const walk = vi.mocked(moveNear);

beforeEach(() => {
  walk.mockReset();
});

/** A scene where a zombie two blocks away just hurt the Body. */
function attackedScene(items: Record<string, number> = {}): CombatScene {
  const scene = calmScene();
  scene.health = 15;
  scene.hostiles = [zombieAt(2)];
  scene.ticksSinceHurt = 3;
  scene.items = items;
  return scene;
}

/** An `attack` handler that kills at once, or hangs until aborted; it counts its runs. */
function fakeAttack(mode: 'kill' | 'hang') {
  const handler: ActionHandler<'attack'> & { runs: string[] } = {
    kind: 'attack',
    timeoutMs: 60_000,
    runs: [],
    run: async (ctx, action) => {
      handler.runs.push(action.target);
      if (mode === 'kill') return completed({ killed: true });
      await new Promise<void>((resolve) =>
        ctx.signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      return cancelled();
    },
  };
  return handler;
}

function fire(scene: CombatScene) {
  const trigger = fightOrFleeReflex.check(sceneView(scene));
  if (trigger === null) throw new Error('fight_or_flee did not fire');
  return trigger;
}

describe('fight_or_flee check', () => {
  it('fires when a close hostile hurt the Body just now, and reads whether it is armed', () => {
    expect(fire(attackedScene())).toMatchObject({ hostile: 'zombie', armed: false });
    expect(fire(attackedScene({ iron_sword: 1 }))).toMatchObject({ armed: true });
    expect(fire(attackedScene({ stone_axe: 1 }))).toMatchObject({ armed: true });
  });

  it('stays quiet without a fresh hurt or a close hostile', () => {
    const scene = attackedScene();
    scene.ticksSinceHurt = null;
    expect(fightOrFleeReflex.check(sceneView(scene))).toBeNull();
    scene.ticksSinceHurt = 21;
    expect(fightOrFleeReflex.check(sceneView(scene))).toBeNull();
    scene.ticksSinceHurt = 5;
    scene.hostiles = [zombieAt(4.5)];
    expect(fightOrFleeReflex.check(sceneView(scene))).toBeNull();
  });
});

describe('fight_or_flee run', () => {
  it('fights an armed attacker through the attack action and does not run', async () => {
    const scene = attackedScene({ iron_sword: 1 });
    const attack = fakeAttack('kill');
    const ctx = sceneContext(scene);
    ctx.registry.register(attack);

    const outcome = await fightOrFleeReflex.run(fire(scene), ctx);

    expect(outcome.result).toBe('handled');
    expect(attack.runs).toEqual(['zombie']);
    expect(ctx.cancelled()).toBe(1);
    expect(walk).not.toHaveBeenCalled();
    expect(ctx.sink.wakes).toEqual([]);
  });

  it('flees an unarmed Body away from the attacker and raises a danger wake', async () => {
    const scene = attackedScene();
    walk.mockResolvedValue({ ok: true, distance: 14 });
    const ctx = sceneContext(scene);

    const outcome = await fightOrFleeReflex.run(fire(scene), ctx);

    expect(outcome.result).toBe('handled');
    const goal = walk.mock.calls[0]?.[1];
    // The zombie stands at +x, so the flight point lies at -x.
    expect(goal?.x).toBeLessThan(-10);
    expect(ctx.sink.wakes.map((w) => w.reason)).toEqual(['reflex_danger']);
  });

  it('flees even when armed if health is already at the floor', async () => {
    const scene = attackedScene({ iron_sword: 1 });
    scene.health = 6;
    walk.mockResolvedValue({ ok: true, distance: 14 });
    const attack = fakeAttack('kill');
    const ctx = sceneContext(scene);
    ctx.registry.register(attack);

    await fightOrFleeReflex.run(fire(scene), ctx);

    expect(attack.runs).toEqual([]);
    expect(walk).toHaveBeenCalledTimes(1);
  });

  it('breaks off a fight when health falls to 6, then flees', async () => {
    const scene = attackedScene({ iron_sword: 1 });
    walk.mockResolvedValue({ ok: true, distance: 14 });
    const attack = fakeAttack('hang');
    const ctx = sceneContext(scene);
    ctx.registry.register(attack);
    setTimeout(() => {
      scene.health = 5;
    }, 30);

    const outcome = await fightOrFleeReflex.run(fire(scene), ctx);

    expect(attack.runs).toEqual(['zombie']);
    expect(outcome.detail).toContain('health low mid-fight');
    expect(walk).toHaveBeenCalledTimes(1);
    expect(ctx.sink.wakes).toHaveLength(1);
  });

  it('tries another direction when the first flight is blocked', async () => {
    const scene = attackedScene();
    walk
      .mockResolvedValueOnce({ ok: false, reason: 'blocked', message: 'no path' })
      .mockResolvedValueOnce({ ok: true, distance: 14 });
    const ctx = sceneContext(scene);

    const outcome = await fightOrFleeReflex.run(fire(scene), ctx);

    expect(outcome.result).toBe('handled');
    expect(walk).toHaveBeenCalledTimes(2);
    expect(walk.mock.calls[1]?.[1]).not.toEqual(walk.mock.calls[0]?.[1]);
  });

  it('reports a failed flight and still raises the wake', async () => {
    const scene = attackedScene();
    walk.mockResolvedValue({ ok: false, reason: 'blocked', message: 'no path' });
    const ctx = sceneContext(scene);

    const outcome = await fightOrFleeReflex.run(fire(scene), ctx);

    expect(outcome.result).toBe('failed');
    expect(walk).toHaveBeenCalledTimes(3);
    expect(ctx.sink.wakes).toHaveLength(1);
  });
});
