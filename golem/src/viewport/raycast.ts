// Software voxel raycaster: one primary ray per pixel (DDA through cells), from the eye through the
// Body's own loaded blocks, with an exact per-pixel depth test against entities. Pure TypeScript.
//
// Knowledge boundary (by construction):
//  - The only world input is a ViewportWorld. A cell it does not know (null) ends the ray: it is sky.
//  - A ray stops at the first opaque cell. There is no x-ray: nothing behind a wall colours a pixel.
//  - Entities are tested on the same ray and win a pixel only when nearer than the block hit.
//  - The output is pixels only: no text, labels, coordinates, minimap, compass or crosshair.

import { lookOf, type Rgb } from './block-colours.ts';
import type { Vec, ViewportEntity, ViewportRequest, ViewportWorld } from './world.ts';

export interface RenderedRgb {
  width: number;
  height: number;
  /** Row-major RGB, 3 bytes per pixel, top row first. */
  rgb: Uint8Array;
}

// Fog distances: the same constants as Kino's (glass/web/kino/blocktex.ts FOG_NEAR and FOG_FAR).
const FOG_NEAR = 48;
const FOG_FAR = 140;
const SKY_TOP: Rgb = [120, 170, 235];
const SKY_HORIZON: Rgb = [190, 215, 240];
const ENTITY_RGB: Record<string, Rgb> = {
  zombie: [70, 130, 80],
  skeleton: [215, 215, 205],
  creeper: [90, 190, 80],
  player: [60, 100, 200],
};
const UNKNOWN_ENTITY: Rgb = [170, 90, 160];

/** Classic face shading, as Kino's faceShade: top 1, bottom 0.5, east/west 0.6, north/south 0.8. */
const SHADE = { x: 0.6, y: 1, ny: 0.5, z: 0.8 } as const;
type Face = keyof typeof SHADE;

const RANGE_DEFAULT = 96;
const WIDTH_DEFAULT = 320;
const HEIGHT_DEFAULT = 180;
const FOV_DEFAULT = 70;
const INF = Number.POSITIVE_INFINITY;

function hash(a: number, b: number, c: number): number {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const frac = (v: number): number => ((v % 1) + 1) % 1;

/** Sky gradient by the ray's vertical component. */
export function skyAt(dy: number): Rgb {
  const t = Math.min(1, Math.max(0, dy * 2.2));
  const m = (i: 0 | 1 | 2): number => SKY_HORIZON[i] * (1 - t) + SKY_TOP[i] * t;
  return [m(0), m(1), m(2)];
}

/** Ray-box slab test; the entry distance along the ray, or null when the ray misses. */
function rayBox(e: Vec, d: Vec, b: ViewportEntity): number | null {
  const lo = [b.x - b.width / 2, b.y, b.z - b.width / 2];
  const hi = [b.x + b.width / 2, b.y + b.height, b.z + b.width / 2];
  const o = [e.x, e.y, e.z];
  const dir = [d.x, d.y, d.z];
  let t0 = 0;
  let t1 = INF;
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

interface RayResult {
  rgb: Rgb;
  depth: number;
}

/** Walks one ray through cells until the first opaque block, an unloaded cell, or the range. */
function marchRay(
  world: ViewportWorld,
  eye: Vec,
  d: Vec,
  range: number,
): { hit: Rgb | null; face: Face; t: number; tint: Rgb | null; tintN: number; cell: Vec } {
  let cx = Math.floor(eye.x);
  let cy = Math.floor(eye.y);
  let cz = Math.floor(eye.z);
  const sx = d.x > 0 ? 1 : -1;
  const sy = d.y > 0 ? 1 : -1;
  const sz = d.z > 0 ? 1 : -1;
  const tdx = d.x === 0 ? INF : Math.abs(1 / d.x);
  const tdy = d.y === 0 ? INF : Math.abs(1 / d.y);
  const tdz = d.z === 0 ? INF : Math.abs(1 / d.z);
  let tmx = d.x === 0 ? INF : (d.x > 0 ? cx + 1 - eye.x : eye.x - cx) * tdx;
  let tmy = d.y === 0 ? INF : (d.y > 0 ? cy + 1 - eye.y : eye.y - cy) * tdy;
  let tmz = d.z === 0 ? INF : (d.z > 0 ? cz + 1 - eye.z : eye.z - cz) * tdz;
  let tint: Rgb | null = null;
  let tintN = 0;
  let lastBlend = '';
  let t = 0;
  let face: Face = 'y';
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
    const state = world.blockAt(cx, cy, cz);
    if (state === null) break; // not loaded: the Body knows nothing there, so the ray ends as sky
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
    return {
      hit: look.rgb,
      face,
      t,
      tint,
      tintN,
      cell: { x: cx, y: cy, z: cz },
    };
  }
  return { hit: null, face, t, tint, tintN, cell: { x: 0, y: 0, z: 0 } };
}

function shadeRay(
  world: ViewportWorld,
  eye: Vec,
  d: Vec,
  range: number,
  entities: readonly ViewportEntity[],
): RayResult {
  const m = marchRay(world, eye, d, range);
  let col: Rgb;
  let depth = INF;
  if (m.hit) {
    depth = m.t;
    // 16x16 texel noise per face, so surfaces read as blocks rather than flat polygons.
    const pu = Math.floor(frac(m.face === 'x' ? eye.z + d.z * m.t : eye.x + d.x * m.t) * 16);
    const pv = Math.floor(
      frac(m.face === 'y' || m.face === 'ny' ? eye.z + d.z * m.t : eye.y + d.y * m.t) * 16,
    );
    const k = SHADE[m.face] * (0.9 + 0.2 * hash(m.cell.x * 16 + pu, m.cell.y * 16 + pv, m.cell.z));
    col = [m.hit[0] * k, m.hit[1] * k, m.hit[2] * k];
  } else col = skyAt(d.y);
  for (const e of entities) {
    const te = rayBox(eye, d, e);
    if (te !== null && te < depth && te < range) {
      depth = te;
      const b = ENTITY_RGB[e.type] ?? UNKNOWN_ENTITY;
      col = [b[0] * 0.85, b[1] * 0.85, b[2] * 0.85];
    }
  }
  if (m.tint && m.tintN > 0) {
    const a = Math.min(0.75, 0.35 + 0.15 * m.tintN);
    col = [
      col[0] * (1 - a) + m.tint[0] * a,
      col[1] * (1 - a) + m.tint[1] * a,
      col[2] * (1 - a) + m.tint[2] * a,
    ];
  }
  if (depth !== INF) {
    const fg = Math.min(1, Math.max(0, (depth - FOG_NEAR) / (FOG_FAR - FOG_NEAR)));
    if (fg > 0) {
      const s = skyAt(d.y);
      col = [
        col[0] * (1 - fg) + s[0] * fg,
        col[1] * (1 - fg) + s[1] * fg,
        col[2] * (1 - fg) + s[2] * fg,
      ];
    }
  }
  return {
    rgb: [Math.round(col[0]), Math.round(col[1]), Math.round(col[2])],
    depth,
  };
}

/**
 * Renders the view from the eye as RGB pixels. Same input, same output: there is no randomness and
 * no clock in the path.
 */
export function renderRgb(req: ViewportRequest): RenderedRgb {
  const w = req.options?.width ?? WIDTH_DEFAULT;
  const h = req.options?.height ?? HEIGHT_DEFAULT;
  const range = req.options?.range ?? RANGE_DEFAULT;
  const tanV = Math.tan(((req.options?.fov ?? FOV_DEFAULT) * Math.PI) / 360);
  const tanH = tanV * (w / h);
  const entities = req.entities ?? [];
  const { yaw, pitch, eye, world } = req;
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
      const c = shadeRay(
        world,
        eye,
        { x: dx * inv, y: dy * inv, z: dz * inv },
        range,
        entities,
      ).rgb;
      const o = (py * w + px) * 3;
      out[o] = c[0];
      out[o + 1] = c[1];
      out[o + 2] = c[2];
    }
  }
  return { width: w, height: h, rgb: out };
}
