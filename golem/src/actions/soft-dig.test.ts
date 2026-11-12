import { createRequire } from 'node:module';
import minecraftData from 'minecraft-data';
import pathfinderPkg from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { installSoftDig, isSoftDigName, MIN_DIG_HEALTH } from './soft-dig.ts';

const { Movements, goals } = pathfinderPkg;
const requireLib = createRequire(import.meta.url);
// The library does not export its search; the deep paths are stable in the pinned 2.4.5.
const AStar = requireLib('mineflayer-pathfinder/lib/astar.js') as new (
  start: unknown,
  movements: unknown,
  goal: unknown,
  timeout: number,
  tickTimeout?: number,
  searchRadius?: number,
) => {
  compute(): {
    status: string;
    path: Array<{
      x: number;
      y: number;
      z: number;
      toBreak: Array<{ x: number; y: number; z: number }>;
    }>;
  };
};
const Move = requireLib('mineflayer-pathfinder/lib/move.js') as new (
  x: number,
  y: number,
  z: number,
  scaffolding: number,
  cost: number,
) => unknown;

const data = minecraftData('1.21.4');

/** A fake terrain: block names by "x,y,z"; every other cell is air. Ground is stone at y=64. */
class FakeTerrain {
  readonly cells = new Map<string, string>();
  set(x: number, y: number, z: number, name: string): void {
    this.cells.set(`${x},${y},${z}`, name);
  }
  fill(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, name: string): void {
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) this.set(x, y, z, name);
  }
  blockAt(pos: Vec3): unknown {
    const key = `${pos.x},${pos.y},${pos.z}`;
    const name = this.cells.get(key) ?? (pos.y <= 64 ? 'stone' : 'air');
    const info = data.blocksByName[name];
    if (!info) throw new Error(`unknown block ${name}`);
    const solid = info.boundingBox === 'block';
    return {
      name,
      type: info.id,
      position: new Vec3(pos.x, pos.y, pos.z),
      boundingBox: info.boundingBox,
      shapes: solid ? [[0, 0, 0, 1, 1, 1]] : [],
      digTime: () => 200,
    };
  }
}

function movementsFor(
  terrain: FakeTerrain,
  soft: boolean,
  health = 20,
): InstanceType<typeof Movements> {
  const bot = {
    registry: data,
    entity: { position: new Vec3(1.5, 71, 1.5), height: 1.8, effects: {} },
    health,
    game: { minY: 60 },
    blockAt: (p: Vec3) => terrain.blockAt(p),
    pathfinder: { bestHarvestTool: () => null },
    entities: {},
  };
  const m = new Movements(bot as never);
  m.canDig = false;
  m.scafoldingBlocks = [];
  m.allow1by1towers = false;
  if (soft) installSoftDig(m);
  return m;
}

function search(
  movements: unknown,
  from: [number, number, number],
  to: [number, number, number],
  timeout = 2000,
) {
  const start = new Move(from[0], from[1], from[2], 0, 0);
  const goal = new goals.GoalBlock(to[0], to[1], to[2]);
  return new AStar(start, movements, goal, timeout, 40, -1).compute();
}

/** A 3x3 leaf canopy from y=65 to y=70 over stone, the bot on top at (1,71,1), the goal on the ground. */
function canopy(): FakeTerrain {
  const t = new FakeTerrain();
  t.fill(0, 2, 65, 70, 0, 2, 'oak_leaves');
  return t;
}

describe('isSoftDigName', () => {
  it('takes leaves, vines, snow layers and plant cover only', () => {
    for (const n of ['oak_leaves', 'cherry_leaves', 'vine', 'snow', 'fern', 'short_grass']) {
      expect(isSoftDigName(n)).toBe(true);
    }
    for (const n of [
      'chest',
      'crafting_table',
      'white_bed',
      'oak_door',
      'oak_planks',
      'cobblestone',
      'oak_sign',
      'stone',
      'bedrock',
      'lava',
      'oak_log',
      'sand',
      'dirt',
      undefined,
    ]) {
      expect(isSoftDigName(n)).toBe(false);
    }
  });
});

describe('soft-dig pathing over fake terrain', () => {
  it('cannot leave a 6-block canopy without digging', () => {
    const result = search(movementsFor(canopy(), false), [1, 71, 1], [5, 65, 1]);
    expect(result.status).not.toBe('success');
  });

  it('digs down through the leaves and reaches the ground', () => {
    const result = search(movementsFor(canopy(), true), [1, 71, 1], [5, 65, 1]);
    expect(result.status).toBe('success');
    const dug = result.path.flatMap((n) => n.toBreak);
    expect(dug.length).toBeGreaterThan(0);
    for (const p of dug) expect(canopyHas(p)).toBe(true);
  });

  it('never digs a chest, crafting table or bed that blocks the only way', () => {
    for (const name of ['chest', 'crafting_table', 'white_bed']) {
      const t = canopy();
      // Replace the whole canopy by the protected block: the only way down is through it.
      t.fill(0, 2, 65, 70, 0, 2, name);
      const result = search(movementsFor(t, true), [1, 71, 1], [5, 65, 1]);
      expect(result.status, name).not.toBe('success');
    }
  });

  it('never digs a leaf block that touches water or lava', () => {
    for (const fluid of ['water', 'lava']) {
      const t = canopy();
      // A fluid cell touches every leaf of the canopy: put one in the middle of each layer.
      for (let y = 65; y <= 70; y++) t.set(1, y, 1, fluid);
      t.fill(0, 2, 65, 70, 0, 0, 'oak_leaves');
      const m = movementsFor(t, true) as unknown as { safeToBreak(b: unknown): boolean };
      expect(m.safeToBreak(t.blockAt(new Vec3(1, 66, 0))), fluid).toBe(false);
      expect(m.safeToBreak(t.blockAt(new Vec3(0, 66, 0))), fluid).toBe(true);
    }
  });

  it('does not dig leaves under falling sand, or when health is low', () => {
    const t = canopy();
    t.set(0, 71, 0, 'sand');
    const m = movementsFor(t, true) as unknown as { safeToBreak(b: unknown): boolean };
    expect(m.safeToBreak(t.blockAt(new Vec3(0, 70, 0)))).toBe(false);
    expect(m.safeToBreak(t.blockAt(new Vec3(1, 70, 1)))).toBe(true);
    const weak = movementsFor(canopy(), true, MIN_DIG_HEALTH - 1) as unknown as {
      safeToBreak(b: unknown): boolean;
    };
    expect(weak.safeToBreak(canopy().blockAt(new Vec3(1, 70, 1)))).toBe(false);
  });

  it('prefers walking around a leaf to digging through it when the detour is short', () => {
    const t = new FakeTerrain();
    t.fill(5, 5, 65, 66, -1, 1, 'oak_leaves');
    const result = search(movementsFor(t, true), [3, 65, 0], [7, 65, 0]);
    expect(result.status).toBe('success');
    expect(result.path.flatMap((n) => n.toBreak)).toHaveLength(0);
  });

  it('returns a timeout status with a tiny search budget instead of running on', () => {
    const t = new FakeTerrain();
    const result = search(movementsFor(t, true), [0, 65, 0], [400, 65, 0], 1);
    expect(['timeout', 'noPath']).toContain(result.status);
  });
});

function canopyHas(p: { x: number; y: number; z: number }): boolean {
  return p.x >= 0 && p.x <= 2 && p.z >= 0 && p.z <= 2 && p.y >= 65 && p.y <= 70;
}

void FakeTerrain;
