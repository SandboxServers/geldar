// Software voxel raycaster: one primary ray per pixel through the body's own loaded blocks, from the
// eye, with an exact per-pixel depth test against entities. Pure TypeScript, no native module, no GL.
//
// Knowledge boundary (by construction):
//  - The only world input is a StateReader. A cell it does not know (unloaded chunk) ends the ray.
//  - A ray stops at the first opaque cell: there is no x-ray, nothing behind a wall colours a pixel.
//  - Entities are tested on the same ray and win a pixel only when nearer than the block hit.
//  - The output is pixels only: no text, no labels, no coordinates, no minimap, no compass.

import { lookOf, type Rgb } from './colours.ts';

export interface StateReader {
  stateAt(x: number, y: number, z: number): string | undefined;
}

export interface Vec {
  x: number;
  y: number;
  z: number;
}

export interface SeenEntity {
  type: string;
  /** feet position */
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
}

export interface ViewOptions {
  width?: number;
  height?: number;
  /** vertical field of view in degrees (the client default is 70) */
  fov?: number;
  /** blocks */
  range?: number;
}

const SKY_TOP: Rgb = [120, 170, 235];
const SKY_HORIZON: Rgb = [190, 215, 240];
const FOG_NEAR = 48;
const FOG_FAR = 140;
const ENTITY_RGB: Record<string, Rgb> = {
  zombie: [70, 130, 80],
  skeleton: [215, 215, 205],
  creeper: [90, 190, 80],
  player: [60, 100, 200],
};

/** Classic face shading: top 1, bottom 0.5, north/south 0.8, east/west 0.6. */
const SHADE = { x: 0.6, y: 1, ny: 0.5, z: 0.8 } as const;
type Face = keyof typeof SHADE;

function hash(a: number, b: number, c: number): number {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export interface Rendered {
  width: number;
  height: number;
  rgb: Uint8Array;
}

const frac = (v: number): number => ((v % 1) + 1) % 1;

/**
 * yaw/pitch in radians, mineflayer convention: yaw 0 faces -z and grows towards -x; pitch > 0 looks up.
 */
export function renderViewport(
  world: StateReader,
  eye: Vec,
  yaw: number,
  pitch: number,
  entities: readonly SeenEntity[] = [],
  opts: ViewOptions = {},
): Rendered {
  const w = opts.width ?? 320;
  const h = opts.height ?? 180;
  const range = opts.range ?? 96;
  const tanV = Math.tan(((opts.fov ?? 70) * Math.PI) / 360);
  const tanH = tanV * (w / h);
  const out = new Uint8Array(w * h * 3);
  const f: Vec = {
    x: -Math.sin(yaw) * Math.cos(pitch),
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * Math.cos(pitch),
  };
  const r: Vec = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
  const u: Vec = {
    x: r.y * f.z - r.z * f.y,
    y: r.z * f.x - r.x * f.z,
    z: r.x * f.y - r.y * f.x,
  };
  for (let py = 0; py < h; py++) {
    const sy = (1 - ((py + 0.5) / h) * 2) * tanV;
    for (let px = 0; px < w; px++) {
      const sx = (((px + 0.5) / w) * 2 - 1) * tanH;
      const dx = f.x + r.x * sx + u.x * sy;
      const dy = f.y + r.y * sx + u.y * sy;
      const dz = f.z + r.z * sx + u.z * sy;
      const inv = 1 / Math.hypot(dx, dy, dz);
      const c = shadeRay(world, eye, dx * inv, dy * inv, dz * inv, range, entities);
      const o = (py * w + px) * 3;
      out[o] = c[0];
      out[o + 1] = c[1];
      out[o + 2] = c[2];
    }
  }
  return { width: w, height: h, rgb: out };
}

function sky(dy: number): Rgb {
  const t = Math.min(1, Math.max(0, dy * 2.2));
  const m = (i: 0 | 1 | 2): number => SKY_HORIZON[i] * (1 - t) + SKY_TOP[i] * t;
  return [m(0), m(1), m(2)];
}

function rayBox(e: Vec, d: Vec, b: SeenEntity): number | null {
  const lo = [b.x - b.width / 2, b.y, b.z - b.width / 2];
  const hi = [b.x + b.width / 2, b.y + b.height, b.z + b.width / 2];
  const o = [e.x, e.y, e.z];
  const dir = [d.x, d.y, d.z];
  let t0 = 0;
  let t1 = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3; i++) {
    const di = dir[i] as number;
    const oi = o[i] as number;
    if (Math.abs(di) < 1e-9) {
      if (oi < (lo[i] as number) || oi > (hi[i] as number)) return null;
      continue;
    }
    let a = ((lo[i] as number) - oi) / di;
    let c = ((hi[i] as number) - oi) / di;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
    if (t0 > t1) return null;
  }
  return t0;
}

function shadeRay(
  world: StateReader,
  eye: Vec,
  dx: number,
  dy: number,
  dz: number,
  range: number,
  entities: readonly SeenEntity[],
): Rgb {
  let cx = Math.floor(eye.x);
  let cy = Math.floor(eye.y);
  let cz = Math.floor(eye.z);
  const sx = dx > 0 ? 1 : -1;
  const sy = dy > 0 ? 1 : -1;
  const sz = dz > 0 ? 1 : -1;
  const inf = Number.POSITIVE_INFINITY;
  const tdx = dx === 0 ? inf : Math.abs(1 / dx);
  const tdy = dy === 0 ? inf : Math.abs(1 / dy);
  const tdz = dz === 0 ? inf : Math.abs(1 / dz);
  let tmx = dx === 0 ? inf : (dx > 0 ? cx + 1 - eye.x : eye.x - cx) * tdx;
  let tmy = dy === 0 ? inf : (dy > 0 ? cy + 1 - eye.y : eye.y - cy) * tdy;
  let tmz = dz === 0 ? inf : (dz > 0 ? cz + 1 - eye.z : eye.z - cz) * tdz;
  let tint: Rgb | null = null;
  let tintN = 0;
  let lastBlend = '';
  let t = 0;
  let face: Face = 'y';
  let hit: Rgb | null = null;
  let hx = 0;
  let hy = 0;
  let hz = 0;
  while (t < range) {
    if (tmx < tmy && tmx < tmz) {
      t = tmx;
      tmx += tdx;
      cx += sx;
      face = 'x';
    } else if (tmy < tmz) {
      t = tmy;
      tmy += tdy;
      cy += sy;
      face = sy > 0 ? 'ny' : 'y';
    } else {
      t = tmz;
      tmz += tdz;
      cz += sz;
      face = 'z';
    }
    const state = world.stateAt(cx, cy, cz);
    if (state === undefined) break; // not loaded: the body knows nothing there
    const look = lookOf(state);
    if (look.kind === 0) continue;
    if (look.kind === 2) {
      if (state !== lastBlend) {
        tint = look.rgb;
        tintN++;
      }
      lastBlend = state;
      continue;
    }
    hit = look.rgb;
    hx = cx;
    hy = cy;
    hz = cz;
    break;
  }
  let col: Rgb;
  let depth = inf;
  if (hit) {
    depth = t;
    // 16x16 texel noise per face, so surfaces read as blocks rather than flat polygons
    const pu = Math.floor(frac(face === 'x' ? eye.z + dz * t : eye.x + dx * t) * 16);
    const pv = Math.floor(
      frac(face === 'y' || face === 'ny' ? eye.z + dz * t : eye.y + dy * t) * 16,
    );
    const k = SHADE[face] * (0.9 + 0.2 * hash(hx * 16 + pu, hy * 16 + pv, hz));
    col = [hit[0] * k, hit[1] * k, hit[2] * k];
  } else col = sky(dy);
  const d: Vec = { x: dx, y: dy, z: dz };
  for (const e of entities) {
    const te = rayBox(eye, d, e);
    if (te !== null && te < depth && te < range) {
      depth = te;
      const b = ENTITY_RGB[e.type] ?? [170, 90, 160];
      col = [b[0] * 0.85, b[1] * 0.85, b[2] * 0.85];
    }
  }
  if (tint && tintN > 0) {
    const a = Math.min(0.75, 0.35 + 0.15 * tintN);
    col = [
      col[0] * (1 - a) + tint[0] * a,
      col[1] * (1 - a) + tint[1] * a,
      col[2] * (1 - a) + tint[2] * a,
    ];
  }
  if (depth !== inf) {
    const fg = Math.min(1, Math.max(0, (depth - FOG_NEAR) / (FOG_FAR - FOG_NEAR)));
    if (fg > 0) {
      const s = sky(dy);
      col = [
        col[0] * (1 - fg) + s[0] * fg,
        col[1] * (1 - fg) + s[1] * fg,
        col[2] * (1 - fg) + s[2] * fg,
      ];
    }
  }
  return [Math.round(col[0]), Math.round(col[1]), Math.round(col[2])];
}
