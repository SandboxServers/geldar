import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// NF-BM-1 and NF-BM-2: BlueMap on the NeoForge shard. neoforge.lock.json pins the 5.29 NeoForge jar; the configs under
// plugins/bluemap/neoforge/ show no player, render on one thread, never run a full render, keep BlueMap's own webserver
// off, and bound the three maps. Each check reads the file it names, so a revert of any line fails the suite.
const ROOT = join(import.meta.dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const DIR = 'plugins/bluemap/neoforge';
const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_DATE_MS = Date.UTC(2026, 10, 18);

// The raw value of a top-level `key: value` line. A list or object value runs to its closing bracket, which may be on a
// later line. A missing key throws, so a deleted key fails the test instead of passing vacuously.
const raw = (text: string, key: string): string => {
  const m = new RegExp(`^${key}:[ \\t]*(\\[[\\s\\S]*?\\]|\\{[\\s\\S]*?\\}|.*)$`, 'm').exec(text);
  if (!m) throw new Error(`key not found: ${key}`);
  return m[1].trim();
};

const strings = (text: string, key: string): string[] =>
  [...raw(text, key).matchAll(/"([^"]*)"/g)].map((m) => m[1]);

const pos = (text: string, key: string) => {
  const m = /x:\s*(-?\d+(?:\.\d+)?)\s*,\s*z:\s*(-?\d+(?:\.\d+)?)/.exec(raw(text, key));
  return m ? { x: Number(m[1]), z: Number(m[2]) } : undefined;
};

const lock = JSON.parse(read('plugins/bluemap/neoforge.lock.json')) as Record<string, unknown>;
const paperLock = JSON.parse(read('plugins/bluemap/bluemap.lock.json')) as { version: string };
const core = read(`${DIR}/core.conf`);
const plugin = read(`${DIR}/plugin.conf`);
const webapp = read(`${DIR}/webapp.conf`);
const webserver = read(`${DIR}/webserver.conf`);

describe('neoforge.lock.json: pin', () => {
  it('pins a 5.x release', () => {
    expect(lock.version).toMatch(/^5\.\d+$/);
  });

  it('pins the same BlueMap version as the Paper lock', () => {
    expect(lock.version).toBe(paperLock.version);
  });

  it('records a 64-hex sha256', () => {
    expect(lock.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('was released at least 14 days before 2026-11-18', () => {
    const released = Date.parse(lock.released_at as string);
    expect(Number.isFinite(released)).toBe(true);
    expect(CHECK_DATE_MS - released).toBeGreaterThanOrEqual(14 * DAY_MS);
  });

  it('has a download URL that names the version and ends in -neoforge.jar, and matches the asset', () => {
    const url = lock.url as string;
    const version = lock.version as string;
    expect(url).toContain(`/download/v${version}/`);
    expect(url).toMatch(/-neoforge\.jar$/);
    expect(url.split('/').pop()).toBe(lock.asset);
    expect(lock.asset).toBe(`bluemap-${version}-neoforge.jar`);
  });

  it('omits size_bytes (not pinned yet: the key is absent, not null)', () => {
    expect(Object.keys(lock)).not.toContain('size_bytes');
  });

  it('names Java 25 and the 26.1.2 Minecraft build the shard runs', () => {
    expect(lock.java).toBe(25);
    expect(lock.minecraft_versions).toContain('26.1.2');
  });
});

describe('NeoForge configs: no player is shown', () => {
  it('turns live player markers off', () => {
    expect(raw(plugin, 'live-player-markers')).toBe('false');
  });

  it('turns skin download off (no Mojang call for skins)', () => {
    expect(raw(plugin, 'skin-download')).toBe('false');
  });

  it('hides vanished, invisible and sneaking players', () => {
    expect(raw(plugin, 'hide-vanished')).toBe('true');
    expect(raw(plugin, 'hide-invisible')).toBe('true');
    expect(raw(plugin, 'hide-sneaking')).toBe('true');
  });

  it('hides every vanilla game mode', () => {
    expect(strings(plugin, 'hidden-game-modes').sort()).toEqual([
      'adventure',
      'creative',
      'spectator',
      'survival',
    ]);
  });

  it('has no player or entity marker set in any map', () => {
    for (const map of readdirSync(join(ROOT, DIR, 'maps'))) {
      expect(raw(read(`${DIR}/maps/${map}`), 'marker-sets').replace(/\s/g, '')).toBe('{}');
    }
  });
});

describe('NeoForge configs: render budget', () => {
  it('renders on one thread', () => {
    expect(Number(raw(core, 'render-thread-count'))).toBe(1);
  });

  it('never runs a full re-render (interval 0)', () => {
    expect(Number(raw(core, 'full-update-interval'))).toBe(0);
  });

  it('checks region files every 30 minutes', () => {
    expect(Number(raw(core, 'region-file-check-interval'))).toBe(30);
  });

  it('sends no metrics and downloads no Mojang client assets', () => {
    expect(raw(core, 'metrics')).toBe('false');
    expect(raw(core, 'accept-download')).toBe('false');
  });
});

describe('NeoForge configs: BlueMap webserver off, files served by Caddy', () => {
  it('disables BlueMap webserver', () => {
    expect(raw(webserver, 'enabled')).toBe('false');
  });

  it('writes the web app under bluemap/web', () => {
    expect(raw(webapp, 'webroot')).toBe('"bluemap/web"');
    expect(raw(webserver, 'webroot')).toBe('"bluemap/web"');
  });
});

describe('NeoForge maps: three maps with finite bounds', () => {
  const expected: Record<
    string,
    { min: { x: number; z: number }; max: { x: number; z: number }; sorting: number }
  > = {
    overworld: { min: { x: -2048, z: -2048 }, max: { x: 2048, z: 2048 }, sorting: 0 },
    nether: { min: { x: -512, z: -512 }, max: { x: 512, z: 512 }, sorting: 1 },
    end: { min: { x: -1024, z: -1024 }, max: { x: 1024, z: 1024 }, sorting: 2 },
  };

  it('has exactly the overworld, nether and end maps', () => {
    const names = readdirSync(join(ROOT, DIR, 'maps'))
      .map((f) => f.replace(/\.conf$/, ''))
      .sort();
    expect(names).toEqual(['end', 'nether', 'overworld']);
  });

  for (const [name, want] of Object.entries(expected)) {
    describe(name, () => {
      const text = read(`${DIR}/maps/${name}.conf`);

      it('has finite min-pos and max-pos with min below max on both axes', () => {
        const min = pos(text, 'min-pos');
        const max = pos(text, 'max-pos');
        expect(min).toBeDefined();
        expect(max).toBeDefined();
        for (const v of [min?.x, min?.z, max?.x, max?.z]) expect(Number.isFinite(v)).toBe(true);
        expect(min?.x).toBeLessThan(max?.x ?? Number.NaN);
        expect(min?.z).toBeLessThan(max?.z ?? Number.NaN);
      });

      it('uses the default bounds the owner/worldops set', () => {
        expect(pos(text, 'min-pos')).toEqual(want.min);
        expect(pos(text, 'max-pos')).toEqual(want.max);
      });

      it('has the expected sorting (unique across maps)', () => {
        expect(Number(raw(text, 'sorting'))).toBe(want.sorting);
      });

      it('stores tiles as files and removes no caves', () => {
        expect(raw(text, 'storage')).toBe('"file"');
        expect(Number(raw(text, 'remove-caves-below-y'))).toBe(-10000);
      });
    });
  }

  it('has unique sorting values', () => {
    const values = Object.values(expected).map((e) => e.sorting);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('NeoForge configs: no host address', () => {
  it('has no IPv4 address or URL in any neoforge config', () => {
    const files = [
      `${DIR}/core.conf`,
      `${DIR}/plugin.conf`,
      `${DIR}/webapp.conf`,
      `${DIR}/webserver.conf`,
      ...readdirSync(join(ROOT, DIR, 'maps')).map((f) => `${DIR}/maps/${f}`),
    ];
    for (const file of files) {
      const text = read(file);
      expect(text, file).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
      expect(text, file).not.toMatch(/https?:\/\//);
    }
  });
});
