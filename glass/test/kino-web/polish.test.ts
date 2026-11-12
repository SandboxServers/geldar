import { describe, expect, it } from 'vitest';
import {
  AGENT_TTL_MS,
  EntityStore,
  LABEL_RADIUS,
  labelStyle,
  MOB_TTL_MS,
} from '../../web/kino/entities.ts';
import { blockedCount, foliageSafeCamera } from '../../web/kino/foliage.ts';
import { aggregateStatus } from '../../web/kino/status.ts';

type EntityPosition = ReturnType<EntityStore['list']>[number];

const ent = (id: string, type: string, x = 0, agent?: string): EntityPosition => ({
  id,
  type,
  x,
  y: 0,
  z: 0,
  yaw: 0,
  pitch: 0,
  ...(agent ? { agent_id: agent } : {}),
});

describe('EntityStore', () => {
  it('keeps identity by id across partial pages (no flicker)', () => {
    const s = new EntityStore();
    s.merge([ent('e41', 'minecraft:bat'), ent('e97', 'minecraft:creeper')], 0);
    // The next page holds only the creeper, at the index the bat had before.
    const out = s.merge([ent('e97', 'minecraft:creeper', 5)], 1000);
    expect(out.map((e) => e.id).sort()).toEqual(['e41', 'e97']);
    expect(out.find((e) => e.id === 'e41')?.type).toBe('minecraft:bat');
    expect(out.find((e) => e.id === 'e97')?.x).toBe(5);
  });

  it('expires a mob only after its quiet period, an agent later', () => {
    const s = new EntityStore();
    s.merge([ent('a', 'minecraft:player', 0, 'ag'), ent('m', 'minecraft:cow')], 0);
    expect(s.merge([], MOB_TTL_MS).length).toBe(2);
    expect(s.merge([], MOB_TTL_MS + 1).map((e) => e.id)).toEqual(['a']);
    expect(s.merge([], AGENT_TTL_MS + 1).length).toBe(0);
  });
});

describe('labelStyle', () => {
  it('always labels agents', () => {
    expect(labelStyle(true, 500).visible).toBe(true);
  });
  it('labels mobs only near, fading and shrinking with distance', () => {
    expect(labelStyle(false, LABEL_RADIUS).visible).toBe(false);
    const near = labelStyle(false, 1);
    const far = labelStyle(false, 10);
    expect(near.visible && far.visible).toBe(true);
    expect(near.opacity).toBeGreaterThan(far.opacity);
    expect(near.scale).toBeGreaterThan(far.scale);
    expect(near.scale).toBeLessThan(1);
  });
});

const leaves = (cells: string[]) => ({
  stateAt: (x: number, y: number, z: number) =>
    cells.includes(`${x},${y},${z}`) ? 'minecraft:oak_leaves' : 'minecraft:air',
});

describe('foliage camera', () => {
  const agent = { x: 0.5, y: 5.5, z: 0.5 };
  it('counts leaves on the line and ignores air', () => {
    const w = leaves(['2,5,0', '3,5,0', '4,5,0']);
    expect(blockedCount(w, agent, { x: 8.5, y: 5.5, z: 0.5 })).toBe(3);
    expect(blockedCount(leaves([]), agent, { x: 8.5, y: 5.5, z: 0.5 })).toBe(0);
  });
  it('leaves a clear camera alone', () => {
    const cam = { x: 8.5, y: 5.5, z: 0.5 };
    expect(foliageSafeCamera(leaves([]), agent, cam)).toEqual(cam);
  });
  it('pulls a camera buried in a canopy in towards the agent, on every axis', () => {
    for (const [dx = 0, dy = 0, dz = 0] of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ]) {
      const cam = { x: agent.x + dx * 9, y: agent.y + dy * 9, z: agent.z + dz * 9 };
      const cells: string[] = [];
      for (let i = 4; i <= 9; i++) {
        cells.push(
          `${Math.floor(agent.x + dx * i)},${Math.floor(agent.y + dy * i)},${Math.floor(agent.z + dz * i)}`,
        );
      }
      const p = foliageSafeCamera(leaves(cells), agent, cam);
      const d = Math.hypot(p.x - agent.x, p.y - agent.y, p.z - agent.z);
      expect(d).toBeLessThan(9);
      expect(d).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('aggregateStatus', () => {
  it('sums panes and is connected if any pane is', () => {
    const a = aggregateStatus(
      [
        { connected: false, chunks: 0, entities: 0 },
        { connected: true, chunks: 280, entities: 137 },
      ],
      { state: 'loading' },
    );
    expect(a).toMatchObject({ connected: true, chunks: 280, entities: 137 });
    expect(aggregateStatus([], { state: 'loading' }).connected).toBe(false);
  });
});
