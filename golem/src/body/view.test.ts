import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { createBodyView } from './view.ts';

/** A bot with just what `createBodyView` reads; the test changes the fields between reads. */
function viewBot() {
  const emitter = new EventEmitter() as unknown as Record<string, unknown>;
  const state = {
    blocks: {} as Record<string, string>,
    findBlockCalls: 0,
    bed: false,
  };
  emitter.entity = {
    position: new Vec3(0.5, 64, 0.5),
    velocity: new Vec3(0, 0, 0),
    onGround: true,
    isInWater: false,
    isInLava: false,
  };
  emitter.entities = {} as Record<string, unknown>;
  emitter.health = 20;
  emitter.food = 20;
  emitter.time = { age: 100, timeOfDay: 15_000 };
  emitter.thunderState = 0;
  emitter.spawnPoint = new Vec3(0, 64, 0);
  emitter.inventory = { items: () => [] };
  emitter.blockAt = (at: Vec3) => {
    const name = state.blocks[`${Math.floor(at.x)},${Math.floor(at.y)},${Math.floor(at.z)}`];
    return name === undefined
      ? { name: 'air', boundingBox: 'empty' }
      : { name, boundingBox: 'block' };
  };
  emitter.findBlock = () => {
    state.findBlockCalls += 1;
    return state.bed ? { name: 'red_bed' } : null;
  };
  return { bot: emitter as unknown as Bot, raw: emitter, state };
}

describe('view: fluids', () => {
  it('reads water from the physics flag, and kelp or seagrass at the feet as water', () => {
    const { bot, raw, state } = viewBot();
    const view = createBodyView(bot);
    expect(view.inFluid).toBeNull();
    (raw.entity as { isInWater: boolean }).isInWater = true;
    expect(view.inFluid).toBe('water');
    (raw.entity as { isInWater: boolean }).isInWater = false;
    state.blocks['0,64,0'] = 'kelp';
    expect(view.inFluid).toBe('water');
    state.blocks['0,64,0'] = 'bubble_column';
    expect(view.inFluid).toBe('water');
  });

  it('reads lava from the physics flag', () => {
    const { bot, raw } = viewBot();
    const view = createBodyView(bot);
    (raw.entity as { isInLava: boolean }).isInLava = true;
    expect(view.inFluid).toBe('lava');
  });
});

describe('view: bed read', () => {
  it('scans for a bed once per 20 ticks, not every read', () => {
    const { bot, raw, state } = viewBot();
    const view = createBodyView(bot);
    expect(view.bedNearby).toBe(false);
    state.bed = true;
    for (let i = 0; i < 10; i++) expect(view.bedNearby).toBe(false);
    expect(state.findBlockCalls).toBe(1);
    (raw.time as { age: number }).age += 20;
    expect(view.bedNearby).toBe(true);
    expect(state.findBlockCalls).toBe(2);
  });
});

describe('view: hostiles', () => {
  /** A zombie at (x, 64, 0.5) whose body faces `yaw`. */
  function zombie(raw: Record<string, unknown>, x: number, yaw: number): void {
    (raw.entities as Record<string, unknown>).z = {
      type: 'hostile',
      name: 'zombie',
      position: new Vec3(x, 64, 0.5),
      yaw,
    };
  }

  it('marks a zombie in reach and facing the Body as attacking', () => {
    const { bot, raw } = viewBot();
    // The Body is west of the zombie; yaw pi/2 faces west (-x).
    zombie(raw, 2.5, Math.PI / 2);
    expect(createBodyView(bot).nearbyHostiles()[0]?.attacking).toBe(true);
  });

  it('does not mark a zombie that faces away, or stands out of reach', () => {
    const { bot, raw } = viewBot();
    zombie(raw, 2.5, -Math.PI / 2);
    expect(createBodyView(bot).nearbyHostiles()[0]?.attacking).toBe(false);
    zombie(raw, 6.5, Math.PI / 2);
    expect(createBodyView(bot).nearbyHostiles()[0]?.attacking).toBe(false);
  });
});

describe('view: pathfinding', () => {
  it('is true while the pathfinder holds a goal', () => {
    const { bot, raw } = viewBot();
    const view = createBodyView(bot);
    expect(view.pathfinding).toBe(false);
    raw.pathfinder = { goal: null };
    expect(view.pathfinding).toBe(false);
    raw.pathfinder = { goal: {} };
    expect(view.pathfinding).toBe(true);
  });
});
