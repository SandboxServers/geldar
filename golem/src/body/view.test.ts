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
  // A ray hits the first cell of `state.blocks` it crosses; the sight test only asks hit or miss.
  emitter.world = {
    raycast: (from: Vec3, dir: Vec3, range: number) => {
      for (let t = 0.25; t < range; t += 0.25) {
        const p = from.plus(dir.scaled(t));
        if (
          state.blocks[`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`] !== undefined
        ) {
          return { position: p };
        }
      }
      return null;
    },
  };
  return { bot: emitter as unknown as Bot, raw: emitter, state };
}

describe('view: hostiles need line of sight', () => {
  // Each sign: a zombie 3 blocks out on one axis, and the one cell the eye-to-body ray crosses.
  it.each([
    ['east', 3.5, 0.5, '2,65,0'],
    ['west', -2.5, 0.5, '-1,65,0'],
    ['south', 0.5, 3.5, '0,65,2'],
    ['north', 0.5, -2.5, '0,65,-1'],
  ])('a zombie to the %s behind a block is absent from nearbyHostiles', (_label, x, z, cell) => {
    const { bot, raw, state } = viewBot();
    (raw.entities as Record<string, unknown>).z = {
      type: 'hostile',
      name: 'zombie',
      position: new Vec3(x, 64, z),
      height: 1.95,
      yaw: 0,
    };
    const view = createBodyView(bot);
    expect(view.nearbyHostiles()).toHaveLength(1);
    state.blocks[cell] = 'stone';
    expect(view.nearbyHostiles()).toEqual([]);
  });
});

describe('view: air is the bot own', () => {
  it('reports full air when oxygenLevel leaked 0 from another entity but the bot has full air', () => {
    const { bot, raw } = viewBot();
    (raw.entity as { metadata: unknown[] }).metadata = [0, 300];
    raw.oxygenLevel = 0;
    expect(createBodyView(bot).air).toBe(20);
  });

  it('reports low air from the bot own metadata, not a full oxygenLevel', () => {
    const { bot, raw } = viewBot();
    (raw.entity as { metadata: unknown[] }).metadata = [0, 75];
    raw.oxygenLevel = 20;
    expect(createBodyView(bot).air).toBe(5);
  });
});

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

describe('view: hostiles on the z axis', () => {
  /** A zombie at (0.5, 64, z) whose body faces `yaw`; the Body stands at (0.5, 64, 0.5). */
  function zombieAt(raw: Record<string, unknown>, z: number, yaw: number): void {
    (raw.entities as Record<string, unknown>).z = {
      type: 'hostile',
      name: 'zombie',
      position: new Vec3(0.5, 64, z),
      yaw,
    };
  }
  const attacking = (z: number, yaw: number): boolean | undefined => {
    const { bot, raw } = viewBot();
    zombieAt(raw, z, yaw);
    return createBodyView(bot).nearbyHostiles()[0]?.attacking;
  };

  it('a mob south of the Body attacks when it faces north, not when it faces south', () => {
    expect(attacking(3.5, 0)).toBe(true);
    expect(attacking(3.5, Math.PI)).toBe(false);
  });

  it('a mob north of the Body attacks when it faces south, not when it faces north', () => {
    expect(attacking(-2.5, Math.PI)).toBe(true);
    expect(attacking(-2.5, 0)).toBe(false);
  });

  it('counts a skeleton-range mob at 4 blocks, not one at 5', () => {
    expect(attacking(4.5, 0)).toBe(true);
    expect(attacking(5.5, 0)).toBe(false);
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

/** The solid cells of a sealed one-block pocket around the Body's feet cell at (0, 64, 0). */
const POCKET = [
  '1,64,0',
  '-1,64,0',
  '0,64,1',
  '0,64,-1',
  '1,65,0',
  '-1,65,0',
  '0,65,1',
  '0,65,-1',
  '0,66,0',
  '0,63,0',
];

describe('view: enclosed', () => {
  it('is true only when solid blocks close the feet cell on every side, above and below', () => {
    const { bot, state } = viewBot();
    const view = createBodyView(bot);
    expect(view.enclosed).toBe(false);
    for (const key of POCKET) state.blocks[key] = 'stone';
    expect(view.enclosed).toBe(true);
    delete state.blocks['0,66,0'];
    expect(view.enclosed).toBe(false);
  });
});

describe('view: lightAtHead', () => {
  it('is the raw 0 to 15 number at the head, not a word, so reflexes can compare levels', () => {
    const { bot, raw } = viewBot();
    raw.blockAt = () => ({ light: 9, skyLight: 0, boundingBox: 'empty' });
    expect(createBodyView(bot).lightAtHead).toBe(9);
  });

  it('is null when the head cell is not loaded', () => {
    const { bot, raw } = viewBot();
    raw.blockAt = () => null;
    expect(createBodyView(bot).lightAtHead).toBeNull();
  });
});
