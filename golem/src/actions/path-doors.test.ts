import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it, vi } from 'vitest';
import {
  cellKey,
  defaultBlock,
  OAK_DOOR_OPEN_LOWER,
  OAK_DOOR_OPEN_UPPER,
  type RealBlock,
  realBlock,
  registry,
} from './door-blocks.fakes.ts';
import {
  isDoorLike,
  lastPathStatus,
  nearDoor,
  onPathUpdate,
  type PathNodeLike,
  snapDoorNodes,
} from './path-doors.ts';
import { ensurePathfinder } from './pathing.ts';

const AIR = realBlock(0);
const STONE = defaultBlock('stone');

/**
 * A bot over a map of real blocks (unlisted cells are air). `emitter` is the bot itself, so a test
 * can emit `path_update` the way the library does.
 */
function fakeBot(cells: Record<string, RealBlock>, feet = new Vec3(-272.5, 68, 365.5)) {
  const emitter = new EventEmitter();
  const bot = Object.assign(emitter, {
    registry,
    game: { minY: 0 },
    entity: { position: feet, isInWater: false },
    blockAt: (v: Vec3) => cells[cellKey(v)] ?? AIR,
    loadPlugin: () => {
      (bot as unknown as { pathfinder: unknown }).pathfinder = { setMovements: vi.fn() };
    },
  });
  return { bot: bot as unknown as Bot, emitter };
}

/** The door of the live case: an open oak door at (-274, 68..69, 365), the house's east wall. */
const liveDoor = (): Record<string, RealBlock> => ({
  '-274,68,365': realBlock(OAK_DOOR_OPEN_LOWER),
  '-274,69,365': realBlock(OAK_DOOR_OPEN_UPPER),
});

/** The node 2.4.5's `postProcessPath` makes over an open lower door: the top of its shape, one block up. */
const LIFTED = { x: -273.5, y: 69, z: 365.703125 };

describe('the real door blocks the rules read', () => {
  it('the diagnosed states are an open oak door, lower then upper, one block tall', () => {
    expect(realBlock(OAK_DOOR_OPEN_LOWER).getProperties()).toMatchObject({
      half: 'lower',
      open: true,
    });
    expect(realBlock(OAK_DOOR_OPEN_UPPER).getProperties()).toMatchObject({
      half: 'upper',
      open: true,
    });
    expect(realBlock(OAK_DOOR_OPEN_LOWER).name).toBe('oak_door');
  });

  it('an iron door and an iron trapdoor are walls, not doors', () => {
    expect(isDoorLike(defaultBlock('iron_door'))).toBe(false);
    expect(isDoorLike({ name: 'iron_trapdoor' })).toBe(false);
  });

  it('a door and a fence gate are door-like, stone is not', () => {
    expect(isDoorLike(realBlock(OAK_DOOR_OPEN_LOWER))).toBe(true);
    expect(isDoorLike({ name: 'oak_fence_gate' })).toBe(true);
    expect(isDoorLike(STONE)).toBe(false);
    expect(isDoorLike({ name: 'oak_trapdoor' })).toBe(false);
  });
});

describe('snapDoorNodes: a node lifted onto an open door goes back in the doorway', () => {
  it('moves the lifted node to the door cell centre at the door floor', () => {
    const { bot } = fakeBot(liveDoor());
    const path: PathNodeLike[] = [{ ...LIFTED }];
    snapDoorNodes(path, bot);
    expect(path[0]).toEqual({ x: -273.5, y: 68, z: 365.5 });
  });

  it('leaves a doorway node, an upper-half node, a node over stone and one over an iron door alone', () => {
    const { bot } = fakeBot({
      ...liveDoor(),
      '-273,68,364': STONE,
      '5,68,5': defaultBlock('iron_door'),
    });
    expect(defaultBlock('iron_door').getProperties()).toMatchObject({ half: 'lower' });
    const nodes: PathNodeLike[] = [
      { x: -273.5, y: 68, z: 365.5 },
      { x: -273.5, y: 70, z: 365.5 },
      { x: -272.5, y: 69, z: 364.5 },
      { x: 5.5, y: 69, z: 5.5 },
    ];
    snapDoorNodes(nodes, bot);
    expect(nodes).toEqual([
      { x: -273.5, y: 68, z: 365.5 },
      { x: -273.5, y: 70, z: 365.5 },
      { x: -272.5, y: 69, z: 364.5 },
      { x: 5.5, y: 69, z: 5.5 },
    ]);
  });
});

describe('onPathUpdate: snaps the array the library stores and records the status', () => {
  it('snaps the node in the array it hands over, and keeps its status', () => {
    const { bot } = fakeBot(liveDoor());
    const path: PathNodeLike[] = [{ ...LIFTED }];
    onPathUpdate(bot, { status: 'success', path });
    expect(path[0]).toEqual({ x: -273.5, y: 68, z: 365.5 });
    expect(lastPathStatus(bot)).toBe('success');
  });

  it('ignores an update with no path', () => {
    const { bot } = fakeBot({});
    onPathUpdate(bot, null);
    expect(lastPathStatus(bot)).toBeUndefined();
  });
});

describe('ensurePathfinder: the library’s path_update reaches the snap', () => {
  it('a path_update from the library snaps the door node in the path it follows', () => {
    const { bot, emitter } = fakeBot(liveDoor());
    ensurePathfinder(bot);
    const path: PathNodeLike[] = [{ ...LIFTED }];
    emitter.emit('path_update', { status: 'success', path });
    expect(path[0]).toEqual({ x: -273.5, y: 68, z: 365.5 });
  });
});

describe('nearDoor: a door beside the bot or the next path node', () => {
  it('is true beside a door, false well away from one', () => {
    const { bot } = fakeBot(liveDoor(), new Vec3(-273.5, 68, 365.5));
    expect(nearDoor(bot)).toBe(true);
    const far = fakeBot(liveDoor(), new Vec3(-270.5, 68, 365.5)).bot;
    expect(nearDoor(far)).toBe(false);
  });

  it('is true when the path node nearest the bot touches a door', () => {
    // Nodes are centred on their cells, as the library hands them over.
    const { bot } = fakeBot(liveDoor(), new Vec3(-270.5, 68, 365.5));
    onPathUpdate(bot, { status: 'success', path: [{ x: -273.5, y: 68, z: 365.5 }] });
    expect(nearDoor(bot)).toBe(true);
    onPathUpdate(bot, { status: 'success', path: [{ x: -267.5, y: 68, z: 365.5 }] });
    expect(nearDoor(bot)).toBe(false);
  });

  it('measures the nearest node from its centre: a decoy half a block away does not win', () => {
    // The bot is at (-272.5, 365.5). Node Q is 1.41 away, node R is 1.0 away and beside the door
    // at (-271, 365). Only R is the nearest node, so only R's door counts.
    const { bot } = fakeBot(
      { '-271,68,365': realBlock(OAK_DOOR_OPEN_LOWER) },
      new Vec3(-272.5, 68, 365.5),
    );
    onPathUpdate(bot, {
      status: 'success',
      path: [
        { x: -273.5, y: 68, z: 364.5 },
        { x: -271.5, y: 68, z: 365.5 },
      ],
    });
    expect(nearDoor(bot)).toBe(true);
  });

  it('is false beside an iron door, which is a wall', () => {
    const { bot } = fakeBot(
      { '-274,68,365': defaultBlock('iron_door') },
      new Vec3(-273.5, 68, 365.5),
    );
    expect(nearDoor(bot)).toBe(false);
  });
});
