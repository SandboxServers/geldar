import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The privacy rule for the public NeoForge shard: no player marker, no player position and no player skin in the BlueMap map.
// BlueMap's defaults show players, so each setting below is read from the committed bundle (plugins/bluemap/neoforge) and
// asserted. A fix that flips one of these fails a named test here. The files are read, never changed by this test.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const BUNDLE = join(ROOT, 'plugins/bluemap/neoforge');
const read = (rel: string) => readFileSync(join(BUNDLE, rel), 'utf8');

/** The text with comments removed: a '#' at line start or after whitespace (a '#' inside a quoted colour is kept). */
const bare = (text: string) => text.replace(/(^|\s)#.*$/gm, '');

/** The value of a top-level "key: value" line (quotes kept), or undefined when the key is absent or only commented out. */
function value(text: string, key: string): string | undefined {
  const m = bare(text).match(new RegExp(`^[ \\t]*${key}:[ \\t]*(.+?)[ \\t]*$`, 'm'));
  return m?.[1];
}

const GAME_MODES = ['adventure', 'creative', 'spectator', 'survival'];

describe('BlueMap privacy: plugin.conf (no player shown)', () => {
  it('live-player-markers is false (no live player endpoint, no player markers)', () => {
    expect(value(read('plugin.conf'), 'live-player-markers')).toBe('false');
  });

  it('skin-download is false (no skin fetch for a joining player)', () => {
    expect(value(read('plugin.conf'), 'skin-download')).toBe('false');
  });

  it('hidden-game-modes lists all four vanilla game modes', () => {
    const m = bare(read('plugin.conf')).match(/hidden-game-modes:\s*\[([^\]]*)\]/);
    expect(m).not.toBeNull();
    const modes = [...(m?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort();
    expect(modes).toEqual(GAME_MODES);
  });

  it.each(['hide-vanished', 'hide-invisible', 'hide-sneaking'])('%s is true', (key) => {
    expect(value(read('plugin.conf'), key)).toBe('true');
  });

  it('write-players-interval is unset or 0 in every bundle file (players.json is never written)', () => {
    for (const rel of ['plugin.conf', 'core.conf', 'webserver.conf', 'webapp.conf']) {
      const v = value(read(rel), 'write-players-interval');
      expect(v === undefined || v === '0', rel).toBe(true);
    }
  });
});

describe('BlueMap privacy: the web server and the core', () => {
  it('webserver.conf enabled is false (BlueMap binds no port)', () => {
    expect(value(read('webserver.conf'), 'enabled')).toBe('false');
  });

  it('core.conf accept-download is true (the Mojang assets the render needs) and metrics is false', () => {
    expect(value(read('core.conf'), 'accept-download')).toBe('true');
    expect(value(read('core.conf'), 'metrics')).toBe('false');
  });

  it('webapp.conf webroot is "bluemap/web" (the directory Caddy serves)', () => {
    expect(value(read('webapp.conf'), 'webroot')).toBe('"bluemap/web"');
  });

  it('storages/file.conf root is "bluemap/web/maps" (the tiles go under the served webroot)', () => {
    expect(value(read('storages/file.conf'), 'root')).toBe('"bluemap/web/maps"');
  });
});

describe('BlueMap privacy: the maps', () => {
  it('maps/ holds exactly overworld, nether and end (no other map is loaded)', () => {
    expect(readdirSync(join(BUNDLE, 'maps')).sort()).toEqual([
      'end.conf',
      'nether.conf',
      'overworld.conf',
    ]);
  });

  it.each(['overworld', 'nether', 'end'])('%s: no static marker set and no hide-* weakened', (map) => {
    const text = bare(read(`maps/${map}.conf`));
    expect(text).toMatch(/marker-sets:\s*\{\s*\}/);
    expect(text).not.toMatch(/hide-[a-z-]+:\s*false/);
    expect(text).not.toMatch(/player/i);
  });
});
