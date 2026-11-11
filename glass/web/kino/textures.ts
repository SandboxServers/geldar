// Vanilla textures come from the map's textures.json (BlueMap), fetched by the browser and held in
// the browser's own cache. Nothing is written to disk and no texture image is committed. The file
// is gzip on the wire; the browser decodes it before fetch() returns the body.
//
// BlueMap's format: { "textures": [ { "id": "minecraft:block/stone", "texture": "data:image/png;base64,..." } ] }.
// A flat { id: dataUri } object is accepted too.

import type { Face, Uv, UvLookup } from './mesher.ts';

export interface CacheLike {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
}

export interface TextureSource {
  fetch: (url: string) => Promise<Response>;
  cache?: CacheLike;
}

export function parseTextures(json: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const root = (json ?? {}) as { textures?: unknown };
  if (Array.isArray(root.textures)) {
    for (const t of root.textures as { id?: unknown; texture?: unknown }[]) {
      if (typeof t?.id === 'string' && typeof t.texture === 'string') out.set(t.id, t.texture);
    }
  } else if (typeof json === 'object' && json !== null) {
    for (const [id, v] of Object.entries(json)) if (typeof v === 'string') out.set(id, v);
  }
  return out;
}

/** Loads textures.json: from the browser cache when present, else from the network and then cached. */
export async function loadTextures(url: string, src: TextureSource): Promise<Map<string, string>> {
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
export function textureCandidates(state: string, face: Face): string[] {
  const m = /^([^:]+):([^[]+)/.exec(state);
  if (!m) return [];
  const base = `${m[1]}:block/${m[2]}`;
  if (face === 'py') return [`${base}_top`, `${base}_end`, base];
  if (face === 'ny') return [`${base}_bottom`, `${base}_end`, `${base}_top`, base];
  return [`${base}_side`, base, `${base}_top`];
}

export function makeUvLookup(layout: AtlasLayout): UvLookup {
  return (state, face) => {
    for (const id of textureCandidates(state, face)) {
      const slot = layout.slotOf.get(id);
      if (slot !== undefined) return layout.uvOfSlot(slot);
    }
    return layout.uvOfSlot(0);
  };
}
