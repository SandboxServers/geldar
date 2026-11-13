import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelled, completed } from '../../actions/outcome.ts';
import { moveNear } from '../../actions/pathing.ts';
import type { ActionHandler } from '../../actions/registry.ts';
import { MemorySink } from '../records.ts';
import { ReflexRunner } from '../reflex.ts';
import { allReflexesOn } from '../reflex-config.ts';
import type { BodyView } from '../view.ts';
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

describe('fight_or_flee: who is blamed', () => {
  it('ignores neutral mobs, and a spider by day', () => {
    const scene = attackedScene({ iron_sword: 1 });
    for (const name of ['enderman', 'zombified_piglin']) {
      scene.hostiles = [zombieAt(2, name)];
      expect(fightOrFleeReflex.check(sceneView(scene))).toBeNull();
    }
    scene.hostiles = [zombieAt(2, 'spider')];
    expect(fightOrFleeReflex.check(sceneView(scene))).not.toBeNull();
    const day = sceneView(scene);
    Object.defineProperty(day, 'isNight', { value: false });
    expect(fightOrFleeReflex.check(day)).toBeNull();
  });

  it('needs the mob to be hitting the Body: in reach and facing', () => {
    const scene = attackedScene();
    scene.hostiles = [{ ...zombieAt(3), attacking: false }];
    expect(fightOrFleeReflex.check(sceneView(scene))).toBeNull();
    scene.hostiles = [
      { ...zombieAt(3), attacking: false },
      { ...zombieAt(3.5), attacking: true },
    ];
    expect(fightOrFleeReflex.check(sceneView(scene))).toMatchObject({ distance: 3.5 });
  });

  it('never fights a creeper, even armed: it runs', () => {
    const scene = attackedScene({ iron_sword: 1 });
    scene.hostiles = [zombieAt(2, 'creeper')];
    expect(fightOrFleeReflex.check(sceneView(scene))).toMatchObject({ armed: false });
  });
});

describe('fight_or_flee: a flight never digs (decision 0164)', () => {
  it('flees from an unarmed Body with digTier false', async () => {
    walk.mockResolvedValue({ ok: true, distance: 14 });
    await fightOrFleeReflex.run(
      fire(attackedScene()),
      sceneContext(attackedScene(), { timeScale: 1 }),
    );
    expect(walk.mock.calls[0]?.[3]).toMatchObject({ digTier: false });
  });
});

describe('fight_or_flee: time scale', () => {
  it('passes the runtime time scale to the attack action and to the flight', async () => {
    const scene = attackedScene({ iron_sword: 1 });
    const seen: number[] = [];
    const handler: ActionHandler<'attack'> = {
      kind: 'attack',
      timeoutMs: 1000,
      run: async (actx) => {
        seen.push(actx.timeScale);
        return completed({ killed: true });
      },
    };
    const ctx = sceneContext(scene, { timeScale: 3 });
    ctx.registry.register(handler);
    await fightOrFleeReflex.run(fire(scene), ctx);
    expect(seen).toEqual([3]);

    walk.mockResolvedValue({ ok: true, distance: 14 });
    await fightOrFleeReflex.run(
      fire(attackedScene()),
      sceneContext(attackedScene(), { timeScale: 3 }),
    );
    expect(walk.mock.calls[0]?.[3]).toMatchObject({ timeScale: 3 });
  });
});

/** A calm scene with one creeper at the given distance, hissing or not. */
function hissScene(distance: number, hissing = true): CombatScene {
  const scene = calmScene();
  scene.hostiles = [{ ...zombieAt(distance, 'creeper'), hissing }];
  return scene;
}

describe('fight_or_flee: a hissing creeper in sight (decision 0154, ruling 6)', () => {
  it('fires for a hissing creeper within 5 blocks, and only then', () => {
    expect(fightOrFleeReflex.check(sceneView(hissScene(3)))).toMatchObject({
      hostile: 'creeper',
      cause: 'hiss',
    });
    expect(fightOrFleeReflex.check(sceneView(hissScene(5)))).not.toBeNull();
    expect(fightOrFleeReflex.check(sceneView(hissScene(6)))).toBeNull();
    expect(fightOrFleeReflex.check(sceneView(hissScene(3, false)))).toBeNull();
  });

  it('a hissing creeper out of sight is absent from the view, so it does not fire', () => {
    // Sight is applied by nearbyHostiles (PX-2b); a hidden creeper is not in the list at all.
    const scene = calmScene();
    scene.hostiles = [];
    expect(fightOrFleeReflex.check(sceneView(scene))).toBeNull();
  });

  it('runs from the creeper rather than fighting it, even when armed', async () => {
    walk.mockResolvedValue({ ok: true, distance: 14 });
    const scene = hissScene(3);
    scene.items = { iron_sword: 1 };
    const attack = fakeAttack('kill');
    const ctx = sceneContext(scene);
    ctx.registry.register(attack);

    const outcome = await fightOrFleeReflex.run(fire(scene), ctx);

    expect(outcome.result).toBe('handled');
    expect(outcome.detail).toContain('hiss');
    expect(attack.runs).toEqual([]);
    expect(walk).toHaveBeenCalledTimes(1);
    expect(ctx.sink.wakes.map((w) => w.reason)).toEqual(['reflex_danger']);
  });

  it('a flight cut short by the bot ending fails with no throw and no walk', async () => {
    const scene = hissScene(3);
    const controller = new AbortController();
    controller.abort();
    const ctx = sceneContext(scene, { signal: controller.signal });

    const outcome = await fightOrFleeReflex.run(fire(scene), ctx);

    expect(outcome.result).toBe('failed');
    expect(walk).not.toHaveBeenCalled();
  });

  it('a creeper gone by the time the reflex runs is handled, with no throw', async () => {
    const scene = hissScene(3);
    const trigger = fire(scene);
    scene.hostiles = [];

    const outcome = await fightOrFleeReflex.run(trigger, sceneContext(scene));

    expect(outcome.result).toBe('handled');
    expect(outcome.detail).toContain('already gone');
    expect(walk).not.toHaveBeenCalled();
  });
});

describe('fight_or_flee: flee cooldown (2 s = 40 ticks)', () => {
  it('a second flee within 2 s is suppressed; at 2.0 s it is allowed', async () => {
    walk.mockResolvedValue({ ok: true, distance: 14 });
    const scene = hissScene(3);
    const runner = new ReflexRunner({
      reflexes: [fightOrFleeReflex],
      config: allReflexesOn(),
      view: sceneView(scene) as BodyView,
      sink: new MemorySink(),
      lifeId: 'life-1',
      bodyGeneration: 1,
      context: (tick) => sceneContext(scene, { tick }),
    });

    await runner.onTick(100);
    await runner.onTick(139);
    expect(walk).toHaveBeenCalledTimes(1);
    await runner.onTick(140);
    expect(walk).toHaveBeenCalledTimes(2);
  });
});
