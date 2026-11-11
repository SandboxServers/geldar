import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildAtlasLayout,
  type CacheLike,
  loadTextures,
  makeUvLookup,
  parseTextures,
  textureCandidates,
} from '../../web/kino/textures.ts';

const BODY = { textures: [{ id: 'minecraft:block/stone', texture: 'data:image/png;base64,AAAA' }] };

function memoryCache(): CacheLike & { puts: number } {
  const store = new Map<string, Response>();
  return {
    puts: 0,
    async match(k) {
      return store.get(k)?.clone();
    },
    async put(k, r) {
      this.puts++;
      store.set(k, r);
    },
  };
}

describe('texture loader', () => {
  it('fetches once, then serves the second load from the cache', async () => {
    let fetches = 0;
    const cache = memoryCache();
    const src = {
      cache,
      fetch: async () => {
        fetches++;
        return new Response(JSON.stringify(BODY));
      },
    };
    const first = await loadTextures('https://map.example/maps/w/textures.json', src);
    const second = await loadTextures('https://map.example/maps/w/textures.json', src);
    expect(fetches).toBe(1);
    expect(cache.puts).toBe(1);
    expect(second.get('minecraft:block/stone')).toBe(first.get('minecraft:block/stone'));
  });

  it('does not cache a failed response', async () => {
    const cache = memoryCache();
    const src = { cache, fetch: async () => new Response('no', { status: 500 }) };
    await expect(loadTextures('u', src)).rejects.toThrow(/500/);
    expect(cache.puts).toBe(0);
  });

  it('parses BlueMap array form and a flat map, ignoring junk', () => {
    expect(parseTextures(BODY).size).toBe(1);
    expect(parseTextures({ 'minecraft:block/dirt': 'data:x' }).get('minecraft:block/dirt')).toBe(
      'data:x',
    );
    expect(parseTextures({ textures: [{ id: 3 }, null] }).size).toBe(0);
    expect(parseTextures(null).size).toBe(0);
  });

  it('never touches the filesystem', () => {
    const dir = join(import.meta.dirname, '../../web/kino');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
      expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/node:fs|from 'fs'|writeFile/);
    }
  });
});

describe('atlas and face textures', () => {
  const layout = buildAtlasLayout([
    'minecraft:block/grass_block_top',
    'minecraft:block/grass_block_side',
    'minecraft:block/dirt',
  ]);

  it('gives each texture its own non-overlapping tile, slot 0 reserved', () => {
    const slots = [...layout.slotOf.values()];
    expect(slots).toEqual([1, 2, 3]);
    const rects = [0, ...slots].map((s) => layout.uvOfSlot(s));
    for (const r of rects) {
      expect(r.u0).toBeGreaterThanOrEqual(0);
      expect(r.u1).toBeLessThanOrEqual(1);
      expect(r.v0).toBeGreaterThanOrEqual(0);
      expect(r.v1).toBeLessThanOrEqual(1);
    }
    expect(new Set(rects.map((r) => `${r.u0},${r.v0}`)).size).toBe(4);
  });

  it('picks top, side and bottom textures, falling back to missing', () => {
    const uv = makeUvLookup(layout);
    const grass = 'minecraft:grass_block[snowy=false]';
    expect(uv(grass, 'py')).toEqual(layout.uvOfSlot(1));
    expect(uv(grass, 'px')).toEqual(layout.uvOfSlot(2));
    expect(uv('minecraft:dirt', 'ny')).toEqual(layout.uvOfSlot(3));
    expect(uv('minecraft:unknown_thing', 'pz')).toEqual(layout.uvOfSlot(0));
    expect(textureCandidates('minecraft:oak_log[axis=y]', 'py')[0]).toBe(
      'minecraft:block/oak_log_top',
    );
  });
});

describe('repo hygiene', () => {
  it('commits no texture image under glass/', () => {
    const root = join(import.meta.dirname, '../..');
    const found: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        if (n === 'node_modules') continue;
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(png|jpe?g|gif|webp|ico)$/i.test(n)) found.push(relative(root, p));
      }
    };
    walk(root);
    expect(found).toEqual([]);
  });
});
