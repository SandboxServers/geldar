import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CAMERA_HALF,
  collides,
  EPS,
  moveWithCollision,
  type Vec3,
} from '../../../web/kino/camera/collision.ts';
import { keyMove, pinchDelta } from '../../../web/kino/camera/controls.ts';
import {
  followGoal,
  freeDelta,
  orbitGoal,
  orbitPosition,
  stepFollow,
  stepFree,
} from '../../../web/kino/camera/modes.ts';
import { CameraRig } from '../../../web/kino/camera/rig.ts';
import { encodePaletteIndices } from '../../../web/kino/palette.ts';
import { VoxelWorld } from '../../../web/kino/world.ts';

const STONE = 'minecraft:stone';
const AIR = 'minecraft:air';

/** All-air sections for chunk/section coordinates lo..hi on every axis. */
function airWorld(lo = -1, hi = 1): VoxelWorld {
  const w = new VoxelWorld();
  for (let cx = lo; cx <= hi; cx++)
    for (let sy = lo; sy <= hi; sy++)
      for (let cz = lo; cz <= hi; cz++)
        w.applySection({
          type: 'chunk_section',
          chunk_x: cx,
          chunk_z: cz,
          section_y: sy,
          palette: [AIR],
          bits: 1,
          data: encodePaletteIndices(new Uint16Array(4096), 1),
        });
  return w;
}

/** A one-block-thick plane of stone at `axis` = coord, covering -8..23 on the others. */
function wall(w: VoxelWorld, axis: 'x' | 'y' | 'z', coord: number, state = STONE): void {
  for (let a = -8; a < 24; a++)
    for (let b = -8; b < 24; b++) {
      const pos =
        axis === 'x'
          ? { x: coord, y: a, z: b }
          : axis === 'y'
            ? { x: a, y: coord, z: b }
            : { x: a, y: b, z: coord };
      w.applyUpdate({ type: 'block_update', pos, state });
    }
}

const START: Vec3 = { x: 8.5, y: 8.5, z: 8.5 };
const d = (axis: 'x' | 'y' | 'z', v: number): Vec3 => ({
  x: axis === 'x' ? v : 0,
  y: axis === 'y' ? v : 0,
  z: axis === 'z' ? v : 0,
});

describe('collision stops at a wall on each axis and sign', () => {
  const H = CAMERA_HALF;
  for (const axis of ['x', 'y', 'z'] as const) {
    it(`+${axis}`, () => {
      const w = airWorld();
      wall(w, axis, 12);
      const p = moveWithCollision(w, START, d(axis, 10));
      expect(p[axis]).toBeCloseTo(12 - H - EPS, 6);
      expect(collides(w, p)).toBe(false);
    });
    it(`-${axis}`, () => {
      const w = airWorld();
      wall(w, axis, 4);
      const p = moveWithCollision(w, START, d(axis, -10));
      expect(p[axis]).toBeCloseTo(5 + H + EPS, 6);
      expect(collides(w, p)).toBe(false);
    });
  }

  it('slides along a wall: the blocked axis stops, the others continue', () => {
    const w = airWorld();
    wall(w, 'x', 12);
    const p = moveWithCollision(w, START, { x: 10, y: 1, z: 2 });
    expect(p.x).toBeCloseTo(12 - H - EPS, 6);
    expect(p.y).toBeCloseTo(9.5, 6);
    expect(p.z).toBeCloseTo(10.5, 6);
  });

  it('never ends inside a solid under random motion', () => {
    const w = airWorld();
    wall(w, 'x', 12);
    wall(w, 'y', 14);
    wall(w, 'z', 2);
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff - 0.5;
    };
    let p = START;
    for (let i = 0; i < 400; i++) {
      p = moveWithCollision(w, p, { x: rnd() * 6, y: rnd() * 6, z: rnd() * 6 });
      expect(collides(w, p)).toBe(false);
    }
  });

  it('treats an unloaded section as solid', () => {
    const w = airWorld(0, 0);
    const p = moveWithCollision(w, START, { x: 30, y: 0, z: 0 });
    expect(p.x).toBeCloseTo(16 - H - EPS, 6);
    expect(collides(w, { x: 20, y: 8, z: 8 })).toBe(true);
  });

  it('does not move a camera that starts inside a solid, and does not edit the world', () => {
    const w = airWorld();
    wall(w, 'x', 8);
    expect(moveWithCollision(w, START, { x: 5, y: 0, z: 0 })).toEqual(START);
    expect(w.stateAt(8, 8, 8)).toBe(STONE);
    expect(w.stateAt(9, 8, 8)).toBe(AIR);
  });
});

describe('follow', () => {
  const offset = { x: 0, y: 3, z: 8 };
  const target = { x: 8, y: 5, z: 4 };
  it('goal is the look point plus the offset', () => {
    expect(followGoal(target, offset)).toEqual({ x: 8, y: 5 + 1.6 + 3, z: 12 });
  });
  it('keeps its offset in open space', () => {
    const w = airWorld();
    const p = stepFollow(w, { x: 8, y: 6, z: 6 }, target, offset);
    expect(p.x).toBeCloseTo(8, 6);
    expect(p.y).toBeCloseTo(9.6, 6);
    expect(p.z).toBeCloseTo(12, 6);
  });
  it('stops against a wall between it and the goal', () => {
    const w = airWorld();
    wall(w, 'z', 10);
    const p = stepFollow(w, { x: 8, y: 6.5, z: 6 }, target, offset);
    expect(p.z).toBeCloseTo(10 - CAMERA_HALF - EPS, 6);
  });
});

describe('orbit', () => {
  const target = { x: 8, y: 6.9, z: 8 }; // look point y = 8.5
  it('goal math on each axis', () => {
    const c = { x: 0, y: 0, z: 0 };
    expect(orbitGoal(c, 0, 0, 5)).toEqual({ x: 0, y: 0, z: 5 });
    const e = orbitGoal(c, Math.PI / 2, 0, 5);
    expect(e.x).toBeCloseTo(5, 9);
    expect(e.z).toBeCloseTo(0, 9);
    expect(orbitGoal(c, 0, Math.PI / 2, 5).y).toBeCloseTo(5, 9);
    expect(orbitGoal(c, 0, -Math.PI / 2, 5).y).toBeCloseTo(-5, 9);
    expect(orbitGoal(c, Math.PI, 0, 5).z).toBeCloseTo(-5, 9);
  });
  it('uses the full radius in open space', () => {
    const p = orbitPosition(airWorld(), target, 0, 0, 6);
    expect(p.z).toBeCloseTo(14, 6);
  });
  it('shrinks against a wall and recovers when it is gone', () => {
    const w = airWorld();
    wall(w, 'z', 12);
    const near = orbitPosition(w, target, 0, 0, 10);
    expect(near.z).toBeCloseTo(12 - CAMERA_HALF - EPS, 6);
    expect(collides(w, near)).toBe(false);
    wall(w, 'z', 12, AIR);
    expect(orbitPosition(w, target, 0, 0, 10).z).toBeCloseTo(18, 6);
  });
});

describe('free-fly', () => {
  const none = { right: 0, up: 0, forward: 0 };
  it('moves along the look direction, right and up', () => {
    const f = freeDelta(0, 0, { ...none, forward: 1 }, 10, 1);
    expect(f.x).toBeCloseTo(0, 9);
    expect(f.z).toBeCloseTo(-10, 9);
    const r = freeDelta(0, 0, { ...none, right: 1 }, 10, 1);
    expect(r.x).toBeCloseTo(10, 9);
    expect(freeDelta(0, 0, { ...none, up: 1 }, 10, 1).y).toBeCloseTo(10, 9);
    expect(freeDelta(0, Math.PI / 4, { ...none, forward: 1 }, 10, 1).y).toBeLessThan(0);
  });
  it('passes through air only', () => {
    const w = airWorld();
    expect(stepFree(w, START, 0, 0, { ...none, forward: 1 }, 5, 1).z).toBeCloseTo(3.5, 6);
    wall(w, 'z', 5);
    const p = stepFree(w, START, 0, 0, { ...none, forward: 1 }, 5, 1);
    expect(p.z).toBeCloseTo(6 + CAMERA_HALF + EPS, 6);
  });
});

describe('rig', () => {
  it('restarts from the orbit position when its box is in a solid', () => {
    const w = airWorld();
    const rig = new CameraRig();
    rig.mode = 'follow';
    rig.position = { x: 8.5, y: 8.5, z: 8.5 };
    wall(w, 'x', 8);
    rig.update(w, { x: 12, y: 7, z: 8 }, 0.016);
    expect(rig.inside(w)).toBe(false);
  });
  it('free-fly touch impulse flies forward once and is consumed', () => {
    const w = airWorld();
    const rig = new CameraRig();
    rig.setMode('free');
    rig.pitch = 0;
    rig.position = { ...START };
    rig.fly(3);
    rig.update(w, null, 0.016);
    expect(rig.position.z).toBeCloseTo(5.5, 6);
    rig.update(w, null, 0.016);
    expect(rig.position.z).toBeCloseTo(5.5, 6);
  });
  it('clamps pitch and radius', () => {
    const rig = new CameraRig();
    rig.setMode('orbit'); // the default is now follow (the chase camera, decision 0161)
    rig.look(0, 10);
    expect(rig.pitch).toBe(1.5);
    rig.zoom(-1000);
    expect(rig.radius).toBe(2);
    rig.zoom(1000);
    expect(rig.radius).toBe(128);
  });
});

describe('controls (pure parts)', () => {
  it('maps keys to a move vector', () => {
    expect(keyMove(new Set(['w', 'd']))).toEqual({ right: 1, up: 0, forward: 1 });
    expect(keyMove(new Set(['s', 'a', 'shift']))).toEqual({ right: -1, up: -1, forward: -1 });
    expect(keyMove(new Set(['w', 's']))).toEqual({ right: 0, up: 0, forward: 0 });
  });
  it('spreading fingers shrinks the radius', () => {
    expect(pinchDelta(100, 150)).toBeLessThan(0);
    expect(pinchDelta(150, 100)).toBeGreaterThan(0);
  });
});

describe('the camera sends nothing', () => {
  it('uses no network API in any camera module', () => {
    const dir = new URL('../../../web/kino/camera/', import.meta.url);
    for (const f of readdirSync(dir)) {
      const src = readFileSync(new URL(f, dir), 'utf8');
      expect(src, f).not.toMatch(
        /WebSocket|fetch\(|XMLHttpRequest|sendBeacon|\.send\(|EventSource/,
      );
    }
  });
});
