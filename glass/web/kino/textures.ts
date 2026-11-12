// Vanilla textures come from the map's textures.json (BlueMap), fetched by the browser and held in
// the browser's own cache. Nothing is written to disk and no texture image is committed. The file
// is gzip on the wire; the browser decodes it before fetch() returns the body.
//
// BlueMap's real format (verified against a live file): a top-level ARRAY of
// { resourcePath: "minecraft:block/stone", color: [r, g, b, a] (floats, the average colour),
//   halfTransparent: boolean, texture: "data:image/png;base64,...", animation?: {...} }.
// Entry 0 is "bluemap:block/missing". Older guesses stay accepted: { textures: [{ id, texture }] }
// and a flat { id: dataUri } object.

import { faceTextureIds } from './blocktex.ts';
import type { Face, Uv, UvLookup } from './mesher.ts';

export interface CacheLike {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
}

export interface TextureSource {
  fetch: (url: string) => Promise<Response>;
  cache?: CacheLike;
}

export interface TextureEntry {
  texture: string;
  /** Average colour, floats 0..1 (r, g, b, a). */
  color: [number, number, number, number];
  halfTransparent: boolean;
}

function parseColor(c: unknown): [number, number, number, number] {
  const a = Array.isArray(c) ? c : [];
  const n = (i: number, d: number): number => (typeof a[i] === 'number' ? (a[i] as number) : d);
  return [n(0, 0.5), n(1, 0.5), n(2, 0.5), n(3, 1)];
}

export function parseTextures(json: unknown): Map<string, TextureEntry> {
  const out = new Map<string, TextureEntry>();
  const list: unknown = Array.isArray(json)
    ? json
    : (json as { textures?: unknown } | null)?.textures;
  if (Array.isArray(list)) {
    for (const t of list as Record<string, unknown>[]) {
      const id = t?.resourcePath ?? t?.id;
      if (typeof id !== 'string' || typeof t.texture !== 'string') continue;
      out.set(id, {
        texture: t.texture,
        color: parseColor(t.color),
        halfTransparent: t.halfTransparent === true,
      });
    }
  } else if (typeof json === 'object' && json !== null) {
    for (const [id, v] of Object.entries(json)) {
      if (typeof v === 'string')
        out.set(id, { texture: v, color: parseColor(null), halfTransparent: false });
    }
  }
  return out;
}

/** Loads textures.json: from the browser cache when present, else from the network and then cached. */
export async function loadTextures(
  url: string,
  src: TextureSource,
): Promise<Map<string, TextureEntry>> {
  const hit = await src.cache?.match(url);
  if (hit) return parseTextures(await hit.json());
  const res = await src.fetch(url);
  if (!res.ok) throw new Error(`textures.json: HTTP ${res.status}`);
  if (src.cache) await src.cache.put(url, res.clone());
  return parseTextures(await res.json());
}

/** Atlas grid: slot 0 is reserved for the missing-texture tile. */
export interface AtlasLayout {
  cols: number;
  rows: number;
  slotOf: Map<string, number>;
  uvOfSlot(slot: number): Uv;
}

export function buildAtlasLayout(ids: Iterable<string>): AtlasLayout {
  const names = [...ids];
  const total = names.length + 1;
  const cols = Math.ceil(Math.sqrt(total));
  const rows = Math.ceil(total / cols);
  const slotOf = new Map(names.map((n, i) => [n, i + 1]));
  const uvOfSlot = (slot: number): Uv => {
    const col = slot % cols;
    const row = Math.floor(slot / cols);
    // Half a texel of inset keeps neighbouring tiles from bleeding at a distance.
    const e = 0.001;
    return {
      u0: col / cols + e,
      u1: (col + 1) / cols - e,
      v0: 1 - (row + 1) / rows + e,
      v1: 1 - row / rows - e,
    };
  };
  return { cols, rows, slotOf, uvOfSlot };
}

/** The texture ids to try for a block state's face, best first. */
export const textureCandidates = faceTextureIds;

export function makeUvLookup(
  layout: AtlasLayout,
  textures?: ReadonlyMap<string, { color: readonly number[] }>,
): UvLookup {
  const lookup: UvLookup = (state, face: Face) => {
    for (const id of textureCandidates(state, face)) {
      const slot = layout.slotOf.get(id);
      if (slot !== undefined) return layout.uvOfSlot(slot);
    }
    return layout.uvOfSlot(0);
  };
  if (textures) {
    // The average alpha of the side texture decides whether a rule-less block may be a cube.
    lookup.coverage = (state) => {
      for (const id of textureCandidates(state, 'pz')) {
        const entry = textures.get(id);
        if (entry) return entry.color[3] ?? 1;
      }
      return undefined;
    };
  }
  return lookup;
}
