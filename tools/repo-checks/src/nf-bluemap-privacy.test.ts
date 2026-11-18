import { readdirSync, readFileSync } from 'node:fs';
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

/** The value of a "key: value" line (quotes kept), or undefined when the key is absent or only commented out. HOCON keeps the LAST
 *  of repeated keys, so the last match is the one BlueMap uses; a repeated top-level key is refused by the duplicate-key test. */
function value(text: string, key: string): string | undefined {
  const all = [...bare(text).matchAll(new RegExp(`^[ \\t]*${key}:[ \\t]*(.+?)[ \\t]*$`, 'gm'))];
  return all.at(-1)?.[1];
}

/** The top-level keys (no indent) that appear more than once in a file. */
function repeatedKeys(text: string): string[] {
  const keys = [...bare(text).matchAll(/^([A-Za-z][\w-]*)[ \t]*[:={]/gm)].map((m) => m[1] ?? '');
  return keys.filter((k, i) => keys.indexOf(k) !== i);
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

  it('write-players-interval is present and exactly 0 in plugin.conf (players.json is never written)', () => {
    expect(value(read('plugin.conf'), 'write-players-interval')).toBe('0');
  });

  it('write-players-interval is unset or 0 in the other bundle files', () => {
    for (const rel of ['core.conf', 'webserver.conf', 'webapp.conf']) {
      const v = value(read(rel), 'write-players-interval');
      expect(v === undefined || v === '0', rel).toBe(true);
    }
  });
});

describe('BlueMap privacy: every committed .conf', () => {
  it('no top-level key appears twice (HOCON keeps the last one, so a repeat could change a value without this test seeing it)', () => {
    const confs = read('MANIFEST.sha256')
      .trim()
      .split('\n')
      .map((line) => line.split(/ {2}/)[1] ?? '')
      .filter((rel) => rel.endsWith('.conf'));
    expect(confs.length).toBeGreaterThan(0);
    for (const rel of confs) expect(repeatedKeys(read(rel)), rel).toEqual([]);
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

  it.each(['overworld', 'nether', 'end'])(
    '%s: no static marker set and no hide-* weakened',
    (map) => {
      const text = bare(read(`maps/${map}.conf`));
      expect(text).toMatch(/marker-sets:\s*\{\s*\}/);
      expect(text).not.toMatch(/hide-[a-z-]+:\s*false/);
      expect(text).not.toMatch(/player/i);
    },
  );
});
