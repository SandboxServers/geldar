import { describe, expect, it } from 'vitest';
import type { FakeWorld } from '../perception/perception.fakes.ts';
import { flatWorld, partlyLoadedBot, unloadedBot } from './body-image.fakes.ts';
import { entitiesInSight, eyeCellLoaded, readBodyScene } from './reader.ts';
import { snapshotWorld } from './snapshot.ts';

const SIZE = { width: 64, height: 36 };

function wall(world: FakeWorld, x: number): void {
  for (let y = 60; y <= 70; y++) {
    for (let z = -5; z <= 5; z++) world.set('stone', x, y, z);
  }
}

describe('reader: what the Body can see', () => {
  it('an unloaded chunk reads as null in the scene, so it is sky', () => {
    const world = flatWorld();
    const bot = partlyLoadedBot(world, 5);
    const scene = readBodyScene(bot, SIZE);
    const view = snapshotWorld(scene.snapshot);
    expect(view.blockAt(5, 63, 0)).toBe('stone');
    expect(view.blockAt(6, 63, 0)).toBeNull();
  });

  it('the eye cell unloaded means nothing can be drawn', () => {
    const world = flatWorld();
    expect(eyeCellLoaded(world.bot)).toBe(true);
    expect(eyeCellLoaded(unloadedBot(world))).toBe(false);
  });

  it('an entity in the open is in sight; one behind a wall is absent', () => {
    const open = flatWorld();
    open.entities[1] = { type: 'zombie', position: open.me.position.offset(6, 0, 0), height: 1.95 };
    expect(entitiesInSight(open.bot).map((e) => e.type)).toEqual(['zombie']);

    const walled = flatWorld();
    walled.entities[1] = {
      type: 'zombie',
      position: walled.me.position.offset(6, 0, 0),
      height: 1.95,
    };
    wall(walled, 3);
    expect(entitiesInSight(walled.bot)).toEqual([]);
  });

  it('an entity in sight carries its box and a coarse type only: no name, no username', () => {
    const world = flatWorld();
    world.entities[2] = {
      type: 'player',
      username: 'secret-name',
      name: 'secret-name',
      position: world.me.position.offset(4, 0, 0),
      height: 1.8,
    };
    const [seen] = entitiesInSight(world.bot);
    expect(seen).toEqual({ type: 'player', x: 4.5, y: 64, z: 0.5, width: 0.6, height: 1.8 });
  });

  it('the look comes from the bot: yaw and pitch are copied through', () => {
    const world = flatWorld();
    const bot = { ...world.bot, entity: { ...world.bot.entity, yaw: 0.5, pitch: -0.2 } };
    const scene = readBodyScene(bot as typeof world.bot, SIZE);
    expect(scene.yaw).toBe(0.5);
    expect(scene.pitch).toBe(-0.2);
    expect(scene.width).toBe(64);
    expect(scene.height).toBe(36);
  });
});
