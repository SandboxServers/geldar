import { describe, expect, it } from 'vitest';
import {
  castViewport,
  DEFAULT_COLS,
  DEFAULT_ROWS,
  type Sample,
  type ViewMob,
  type ViewPose,
  type ViewWorld,
} from './viewport.ts';
import { compassOf, describeView } from './viewport-text.ts';

const AIR: Sample = { kind: 'air' };
const STONE: Sample = { kind: 'solid', name: 'stone' };
const GLASS: Sample = { kind: 'glass', name: 'glass' };
const GROUND: Sample = { kind: 'solid', name: 'grass_block' };

/** A fake world: `extra` decides a block first; the ground sits at y=-1 unless `floor` is off; x or z beyond 30 is unloaded. */
function scene(
  extra: (x: number, y: number, z: number) => Sample | undefined = () => undefined,
  opts: { mobs?: ViewMob[]; dark?: boolean; floor?: boolean } = {},
): ViewWorld {
  return {
    mobs: opts.mobs ?? [],
    dark: opts.dark ?? false,
    block(x, y, z) {
      if (Math.abs(x) > 30 || Math.abs(z) > 30) return { kind: 'unknown' };
      const found = extra(x, y, z);
      if (found !== undefined) return found;
      return y === -1 && (opts.floor ?? true) ? GROUND : AIR;
    },
  };
}

/** Feet at y=0 on the ground (y=-1), eyes at 1.62; the body looks north (yaw 0) unless told otherwise. */
const STAND: ViewPose = { x: 0.5, y: 1.62, z: 0.5, yaw: 0, pitch: 0 };

describe('viewport: the pit and the open field', () => {
  it('reports a walled pit as enclosed, with the gap up, and never as open', () => {
    // A 5 by 5 pit, walls two blocks high, the body in the middle: the sky is the only gap.
    const pit = scene((x, y, z) => {
      const ring = Math.max(Math.abs(x), Math.abs(z)) === 2;
      return ring && y >= 0 && y <= 1 ? STONE : undefined;
    });
    const text = describeView(castViewport(pit, STAND));
    expect(text).toContain('Enclosed except for a gap up');
    expect(text).not.toContain('Open:');
  });

  it('reports an open field as open', () => {
    const text = describeView(castViewport(scene(), STAND));
    expect(text).toContain('Open: nothing solid within 2 blocks over most of the view.');
    expect(text).not.toContain('Enclosed');
  });

  it('a grid of the default size has 21 columns and 9 rows', () => {
    const grid = castViewport(scene(), STAND);
    expect(grid.cols).toBe(DEFAULT_COLS);
    expect(grid.rows).toBe(DEFAULT_ROWS);
    expect(grid.rays).toHaveLength(9);
    expect(grid.rays[0]).toHaveLength(21);
  });
});

describe('viewport: nothing behind an opaque block', () => {
  it('does not report a block that sits behind a stone wall', () => {
    const walled = scene((x, y, z) => {
      if (z === -3 && y >= 0 && y <= 3 && Math.abs(x) <= 10) return STONE;
      if (x === 0 && z === -6 && y === 0) return { kind: 'solid', name: 'diamond_ore' };
      return undefined;
    });
    const text = describeView(castViewport(walled, STAND));
    expect(text).toContain('stone');
    expect(text).not.toContain('diamond');
  });

  it('a ray stops at the first opaque block: its solid distance is the first wall, not a later one', () => {
    // Two stone walls on the centre ray (north of the body): the first at z=-3, the second at z=-6.
    const twoWalls = scene((x, y, z) => {
      if ((z === -3 || z === -6) && y >= 0 && y <= 3 && Math.abs(x) <= 10) return STONE;
      return undefined;
    });
    const ray = castViewport(twoWalls, STAND, 1, 1).rays[0]?.[0];
    expect(ray).toMatchObject({
      kind: 'solid',
      name: 'stone',
      distance: 2.75,
      solidDistance: 2.75,
    });
  });

  it('does not report a mob behind a stone wall, and does report one in sight', () => {
    const mobs: ViewMob[] = [
      { name: 'zombie', x: 0.5, y: 0, z: -2, width: 0.6, height: 1.95 },
      { name: 'skeleton', x: 0.5, y: 0, z: -9, width: 0.6, height: 1.95 },
    ];
    const world = scene(
      (x, y, z) => (z === -5 && y >= 0 && y <= 3 && Math.abs(x) <= 10 ? STONE : undefined),
      { mobs },
    );
    const grid = castViewport(world, STAND);
    const text = describeView(grid);
    expect(grid.rays[4]?.[10]).toMatchObject({ kind: 'mob', name: 'zombie' });
    expect(text).toContain('zombie');
    expect(text).not.toContain('skeleton');
  });

  it('reports a transparent block but lets the ray reach the opaque block behind it', () => {
    const world = scene((x, y, z) => {
      if (z === -3 && y >= 0 && y <= 3 && Math.abs(x) <= 10) return GLASS;
      if (z === -6 && y >= 0 && y <= 3 && Math.abs(x) <= 10) return STONE;
      return undefined;
    });
    const centre = castViewport(world, STAND).rays[4]?.[10];
    expect(centre?.kind).toBe('glass');
    expect(centre?.solidDistance).toBeDefined();
  });
});

describe('viewport: unloaded chunks and the dark', () => {
  it('reads an unloaded chunk as unknown, never as air', () => {
    const east: ViewPose = { ...STAND, yaw: -Math.PI / 2 };
    const base = scene();
    const edge: ViewWorld = {
      ...base,
      block: (x, y, z) => (x >= 6 ? { kind: 'unknown' } : base.block(x, y, z)),
    };
    const grid = castViewport(edge, east);
    expect(grid.rays[4]?.[10]?.kind).toBe('unknown');
    const text = describeView(grid);
    expect(text).toContain('unknown (not loaded)');
    expect(text).toContain('Part of the view is not loaded.');
    expect(text).toContain('?');
  });

  it('says it is too dark past the dark range when the light at the eyes is low and nothing is hit', () => {
    const dark = scene(undefined, { dark: true, floor: false });
    const grid = castViewport(dark, STAND);
    expect(grid.rays[4]?.[10]).toMatchObject({ kind: 'dark', distance: 6 });
    expect(describeView(grid)).toContain('too dark past 6 blocks');
  });
});

describe('viewport: geometry signs on each axis', () => {
  it('puts a wall on the east side on the right when facing north', () => {
    const eastWall = scene((x, y, z) =>
      x === 3 && y >= 0 && y <= 3 && Math.abs(z) <= 10 ? STONE : undefined,
    );
    const grid = castViewport(eastWall, STAND);
    expect(grid.rays[4]?.[20]?.kind).toBe('solid');
    expect(grid.rays[4]?.[0]?.kind).toBe('air');
  });

  it('puts a wall on the north side on the left when facing east', () => {
    const northWall = scene((x, y, z) =>
      z === -3 && y >= 0 && y <= 3 && Math.abs(x) <= 10 ? STONE : undefined,
    );
    const grid = castViewport(northWall, { ...STAND, yaw: -Math.PI / 2 });
    expect(grid.rays[4]?.[0]?.kind).toBe('solid');
    expect(grid.rays[4]?.[20]?.kind).toBe('air');
    expect(compassOf(-Math.PI / 2)).toBe('east');
  });

  it('treats a positive pitch as looking up: a ceiling is hit by the top row, not the bottom', () => {
    const ceiling = scene((_x, y) => (y === 2 ? STONE : undefined), { floor: false });
    const grid = castViewport(ceiling, { ...STAND, pitch: 0 });
    expect(grid.rays[0]?.[10]?.kind).toBe('solid');
    expect(grid.rays[8]?.[10]?.kind).toBe('air');
  });

  it('names the compass point from the yaw', () => {
    expect(compassOf(0)).toBe('north');
    expect(compassOf(-Math.PI / 4)).toBe('north-east');
    expect(compassOf(Math.PI)).toBe('south');
    expect(compassOf(Math.PI / 2)).toBe('west');
  });

  it('says looking slightly down for a small negative pitch', () => {
    const grid = castViewport(scene(), { ...STAND, pitch: (-15 * Math.PI) / 180 });
    expect(describeView(grid).split('\n')[0]).toBe('Facing north, looking slightly down.');
  });
});
