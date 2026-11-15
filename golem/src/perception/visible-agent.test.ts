import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { FakeWorld, REGISTRY_PLAYER_NAME } from './perception.fakes.ts';
import { findVisibleAgent, isUsernameVisible } from './visible-agent.ts';

/** A world with the Body at the origin and a stone wall between the eyes and the cell (0, 64, 2). */
function walled(): FakeWorld {
  const world = new FakeWorld();
  for (const [x, y] of [
    [0, 64],
    [0, 65],
    [1, 64],
    [1, 65],
  ] as const) {
    world.set('stone', x, y, 1);
  }
  return world;
}

const bot = (world: FakeWorld) => world.bot as unknown as Parameters<typeof findVisibleAgent>[0];

describe('findVisibleAgent: exact usernames', () => {
  it('resolves an exact username that is visible', () => {
    const world = new FakeWorld();
    world.entities[2] = {
      type: 'player',
      username: 'ag_chapman_01',
      position: new Vec3(0.5, 64, 2.5),
    };
    expect(findVisibleAgent(bot(world), 'ag_chapman_01')?.username).toBe('ag_chapman_01');
  });

  it('does not resolve a loose name when an exact username is loaded but not visible', () => {
    const world = new FakeWorld();
    world.entities[2] = {
      type: 'player',
      username: 'ag_troi_01',
      position: new Vec3(0.5, 64, 30.5),
    };
    world.entities[3] = {
      type: 'player',
      username: 'ag_riker_01',
      position: new Vec3(2.5, 64, 2.5),
    };
    world.setPlayer('ag_riker_01', 'ag_troi_01');
    expect(findVisibleAgent(bot(world), 'ag_troi_01')).toBeNull();
  });
});

describe('findVisibleAgent: loose names among the visible players (decision 0334)', () => {
  it('resolves a handle without the ag_ prefix when exactly one visible player has it', () => {
    const world = new FakeWorld();
    world.entities[2] = {
      type: 'player',
      username: 'ag_chapman_01',
      position: new Vec3(0.5, 64, 2.5),
    };
    expect(findVisibleAgent(bot(world), 'chapman_01')?.username).toBe('ag_chapman_01');
  });

  it('resolves the in-world name from the tab list, case-insensitively, not the registry name', () => {
    const world = new FakeWorld();
    world.entities[2] = {
      type: 'player',
      ...REGISTRY_PLAYER_NAME,
      username: 'ag_zack_01',
      position: new Vec3(0.5, 64, 2.5),
    };
    world.setPlayer('ag_zack_01', 'Zack Ellison');
    expect(findVisibleAgent(bot(world), 'zack ELLISON')?.username).toBe('ag_zack_01');
  });

  it('resolves a short in-world name such as Chapman from the tab list', () => {
    const world = new FakeWorld();
    world.entities[2] = {
      type: 'player',
      ...REGISTRY_PLAYER_NAME,
      username: 'ag_chapman_01',
      position: new Vec3(0.5, 64, 2.5),
    };
    world.setPlayer('ag_chapman_01', 'Chapman');
    expect(findVisibleAgent(bot(world), 'Chapman')?.username).toBe('ag_chapman_01');
  });

  it('never matches the registry word player, even with one visible agent', () => {
    const world = new FakeWorld();
    world.entities[2] = {
      type: 'player',
      ...REGISTRY_PLAYER_NAME,
      username: 'ag_kit_01',
      position: new Vec3(0.5, 64, 2.5),
    };
    world.setPlayer('ag_kit_01', 'Kit');
    expect(findVisibleAgent(bot(world), 'player')).toBeNull();
    expect(findVisibleAgent(bot(world), 'Player')).toBeNull();
    expect(findVisibleAgent(bot(world), 'unknown')).toBeNull();
    expect(findVisibleAgent(bot(world), 'Kit')?.username).toBe('ag_kit_01');
  });

  it('never resolves player or unknown in any case, even as one visible agent handle or display name', () => {
    const handle = new FakeWorld();
    handle.entities[2] = {
      type: 'player',
      username: 'ag_player',
      position: new Vec3(0.5, 64, 2.5),
    };
    for (const name of ['player', 'Player', 'PLAYER']) {
      expect(findVisibleAgent(bot(handle), name)).toBeNull();
    }
    const shown = new FakeWorld();
    shown.entities[2] = {
      type: 'player',
      ...REGISTRY_PLAYER_NAME,
      username: 'ag_scout_01',
      position: new Vec3(0.5, 64, 2.5),
    };
    shown.setPlayer('ag_scout_01', 'Unknown');
    for (const name of ['unknown', 'Unknown', 'UNKNOWN']) {
      expect(findVisibleAgent(bot(shown), name)).toBeNull();
    }
    // The same one visible agent resolves by a name that is not generic, so the nulls are the guard's.
    expect(findVisibleAgent(bot(shown), 'scout_01')?.username).toBe('ag_scout_01');
  });

  it('fails when two visible players match, by handle or display name', () => {
    const world = new FakeWorld();
    world.entities[2] = {
      type: 'player',
      username: 'ag_troi',
      position: new Vec3(0.5, 64, 2.5),
    };
    world.entities[3] = {
      type: 'player',
      username: 'Riker',
      position: new Vec3(-1.5, 64, 2.5),
    };
    world.setPlayer('Riker', 'Troi');
    expect(findVisibleAgent(bot(world), 'troi')).toBeNull();
  });

  it('fails for a loose match that is behind a wall, as for an unknown name', () => {
    const world = walled();
    world.entities[2] = {
      type: 'player',
      username: 'ag_chapman_01',
      position: new Vec3(0.5, 64, 2.5),
    };
    expect(findVisibleAgent(bot(world), 'chapman_01')).toBeNull();
  });

  it('fails for a loose match beyond 24 blocks', () => {
    const world = new FakeWorld();
    world.entities[2] = {
      type: 'player',
      username: 'ag_chapman_01',
      position: new Vec3(0.5, 64, 30.5),
    };
    expect(findVisibleAgent(bot(world), 'chapman_01')).toBeNull();
  });

  it('resolves to the one visible match when another match is out of sight', () => {
    const world = walled();
    world.entities[2] = {
      type: 'player',
      username: 'ag_troi',
      position: new Vec3(0.5, 64, 2.5),
    };
    world.entities[3] = {
      type: 'player',
      username: 'Riker',
      position: new Vec3(-1.5, 64, 2.5),
    };
    world.setPlayer('Riker', 'Troi');
    expect(findVisibleAgent(bot(world), 'Troi')?.username).toBe('Riker');
  });

  it('gives null for an absent name and for an unknown name alike', () => {
    const world = new FakeWorld();
    world.entities[2] = {
      type: 'player',
      username: 'ag_chapman_01',
      position: new Vec3(0.5, 64, 2.5),
    };
    expect(findVisibleAgent(bot(world), 'Nobody')).toBeNull();
    expect(findVisibleAgent(bot(world), 'zack')).toBeNull();
  });
});

describe('isUsernameVisible: the bystander check is exact only (decision 0145)', () => {
  it('is true for an exact username that is visible', () => {
    const world = new FakeWorld();
    world.entities[2] = {
      type: 'player',
      username: 'ag_chapman_01',
      position: new Vec3(0.5, 64, 2.5),
    };
    expect(isUsernameVisible(bot(world), 'ag_chapman_01')).toBe(true);
  });

  it('is false for a handle when the visible agent is ag_chapman_01 (loose names do not count)', () => {
    const world = new FakeWorld();
    world.entities[2] = {
      type: 'player',
      username: 'ag_chapman_01',
      position: new Vec3(0.5, 64, 2.5),
    };
    expect(isUsernameVisible(bot(world), 'chapman_01')).toBe(false);
  });

  it('is false for an exact username that is behind a wall', () => {
    const world = walled();
    world.entities[2] = {
      type: 'player',
      username: 'ag_chapman_01',
      position: new Vec3(0.5, 64, 2.5),
    };
    expect(isUsernameVisible(bot(world), 'ag_chapman_01')).toBe(false);
  });
});
