import { describe, expect, it } from 'vitest';
import { MemorySink } from '../records.ts';
import { ReflexRunner } from '../reflex.ts';
import { allReflexesOn } from '../reflex-config.ts';
import { calmScene, sceneContext, sceneView, zombieAt } from './combat.fakes.ts';
import { combatReflexes } from './combat.ts';

describe('combatReflexes', () => {
  it('lists retreat before fight_or_flee and gives retreat the higher priority', () => {
    expect(combatReflexes.map((r) => r.name)).toEqual(['retreat', 'fight_or_flee']);
    const [retreat, fight] = combatReflexes;
    expect(retreat?.priority).toBeGreaterThan(fight?.priority ?? 0);
  });

  it('runs retreat, not fight_or_flee, when both trigger on one tick', async () => {
    const scene = calmScene();
    scene.health = 4;
    scene.hostiles = [zombieAt(2)];
    scene.ticksSinceHurt = 1;
    scene.safeSpot = null;
    const sink = new MemorySink();
    const runner = new ReflexRunner({
      reflexes: combatReflexes,
      config: allReflexesOn(),
      view: sceneView(scene),
      sink,
      lifeId: 'life-1',
      bodyGeneration: 1,
      context: (tick) => sceneContext(scene, { tick, sink }),
    });

    await runner.onTick(10);

    expect(sink.reflexes.map((r) => r.name)).toEqual(['retreat']);
  });

  it('never fires a disabled reflex', async () => {
    const scene = calmScene();
    scene.health = 4;
    scene.hostiles = [zombieAt(2)];
    const config = allReflexesOn();
    config.flags.retreat = false;
    const sink = new MemorySink();
    const runner = new ReflexRunner({
      reflexes: combatReflexes,
      config,
      view: sceneView(scene),
      sink,
      lifeId: 'life-1',
      bodyGeneration: 1,
      context: (tick) => sceneContext(scene, { tick, sink }),
    });

    await runner.onTick(10);

    expect(sink.reflexes).toEqual([]);
  });
});
