import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Static checks on the committed BlueMap config (C1-09). The config is read as text: each setting
// is a top-level `key: value` line, and `#` lines are comments. A setting that is missing, or that
// is not the exact value, fails the test.

const CONFIG = join(import.meta.dirname, '..', 'config');

// The setting keys of the BlueMap 5.29 defaults, generated from the pinned jar (known-keys.json).
const KNOWN = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'known-keys.json'), 'utf8'),
) as { bluemap: string; jar_sha256: string; files: Record<string, string[]> };

/** The uncommented, unindented `key: value` lines of a file, as a map from key to raw value. */
function settings(file: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of readFileSync(join(CONFIG, file), 'utf8').split('\n')) {
    const m = /^([a-z][a-z0-9-]*):\s*(.*?)\s*$/.exec(line);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

/** The value of a setting, unquoted, or undefined when it is absent. */
function value(file: string, key: string): string | undefined {
  return settings(file)
    .get(key)
    ?.replace(/^"(.*)"$/, '$1');
}

/** Every config file, relative to the config directory, with its text. */
function allConfigText(): string {
  const parts: string[] = [];
  for (const file of readdirSync(CONFIG, { recursive: true, encoding: 'utf8' })) {
    if (file.endsWith('.conf')) parts.push(readFileSync(join(CONFIG, file), 'utf8'));
  }
  return parts.join('\n');
}

describe('BlueMap config: internal only', () => {
  it('runs the integrated webserver on 8101 for the colo network only (R38)', () => {
    // The 5.29 webserver.conf has no bind-address key (no `ip`); it is kept off the host by Paper
    // publishing no port (checked in tools/repo-checks colo-services.test.ts).
    expect(value('webserver.conf', 'enabled')).toBe('true');
    expect(value('webserver.conf', 'port')).toBe('8101');
  });

  it('keeps the config free of IPv4 addresses (no node or network address)', () => {
    expect(allConfigText()).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
  });
});

describe('BlueMap config: every key is a 5.29 key', () => {
  it('is pinned to BlueMap 5.29 with a sha256 of the jar', () => {
    expect(KNOWN.bluemap).toBe('5.29');
    expect(KNOWN.jar_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('covers exactly the files the committed config uses', () => {
    expect(Object.keys(KNOWN.files).sort()).toEqual([
      'core.conf',
      'maps/end.conf',
      'maps/nether.conf',
      'maps/overworld.conf',
      'plugin.conf',
      'webserver.conf',
    ]);
  });

  it('finds every committed key among the 5.29 defaults (BlueMap ignores an unknown key silently)', () => {
    for (const [file, known] of Object.entries(KNOWN.files)) {
      const names = new Set(known);
      for (const key of settings(file).keys()) {
        expect(names.has(key), `${file}: "${key}" is not a 5.29 key`).toBe(true);
      }
    }
  });
});

describe('BlueMap config: bounded render CPU', () => {
  it('caps render threads at 1 or 2, not 0 (0 starts one thread per core and competes with the game tick)', () => {
    const n = Number(value('core.conf', 'render-thread-count'));
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(2);
  });
});

describe('BlueMap config: web root and port (C2-07o)', () => {
  it('writes the web root to bluemap/web, the subpath bluemap-web serves', () => {
    expect(value('webserver.conf', 'webroot')).toBe('bluemap/web');
    expect(value('core.conf', 'data')).toBe('bluemap');
  });

  it('enables the webserver on the port the bluemap-web live proxy targets', () => {
    // The Caddy handler targets the alias proxy, whose default upstream is Paper's BlueMap port.
    const caddy = readFileSync(
      join(import.meta.dirname, '..', 'alias-proxy', 'alias-proxy.ts'),
      'utf8',
    );
    const target = /GELDAR_ALIAS_UPSTREAM_PORT \?\? (\d+)/.exec(caddy);
    expect(target).not.toBeNull();
    expect(value('webserver.conf', 'enabled')).toBe('true');
    expect(value('webserver.conf', 'port')).toBe(target?.[1]);
  });
});

describe('BlueMap config: terrain and live agent positions (R38)', () => {
  it('turns live player markers on and hides spectators and vanished players', () => {
    expect(value('plugin.conf', 'live-player-markers')).toBe('true');
    expect(value('plugin.conf', 'hide-vanished')).toBe('true');
    expect(value('plugin.conf', 'hide-invisible')).toBe('true');
    expect(settings('plugin.conf').get('hidden-game-modes')).toBe('[');
    expect(readFileSync(join(CONFIG, 'plugin.conf'), 'utf8')).toMatch(
      /hidden-game-modes:\s*\[\s*"spectator"\s*\]/,
    );
  });

  it('has Mojang skin downloads on by owner ruling 2026-11-12 (UUID only, so agent heads show)', () => {
    expect(value('plugin.conf', 'skin-download')).toBe('true');
  });

  it('renders the overworld, nether and end of the one Paper world, with no marker sets', () => {
    const maps = readdirSync(join(CONFIG, 'maps')).sort();
    expect(maps).toEqual(['end.conf', 'nether.conf', 'overworld.conf']);
    expect(value('maps/nether.conf', 'dimension')).toBe('minecraft:the_nether');
    expect(value('maps/end.conf', 'dimension')).toBe('minecraft:the_end');
    for (const f of maps) expect(value('maps/' + f, 'world')).toBe('world');
    expect(value('maps/overworld.conf', 'dimension')).toBe('minecraft:overworld');
    const text = readFileSync(join(CONFIG, 'maps', 'overworld.conf'), 'utf8');
    const block = /marker-sets:\s*\{([\s\S]*?)\}/.exec(text);
    expect(block).not.toBeNull();
    const body = (block?.[1] ?? '')
      .split('\n')
      .filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));
    expect(body).toEqual([]);
  });
});

describe('BlueMap config: no secret', () => {
  it('has accept-download true by the owner ruling of 2026-11-11 (Mojang resource download, C2-07o)', () => {
    expect(value('core.conf', 'accept-download')).toBe('true');
  });

  it('keeps bStats metrics off, so the map makes no outbound call', () => {
    expect(value('core.conf', 'metrics')).toBe('false');
  });

  it('holds no token, secret, password or key', () => {
    for (const [file, text] of [
      ['core.conf', readFileSync(join(CONFIG, 'core.conf'), 'utf8')],
      ['webserver.conf', readFileSync(join(CONFIG, 'webserver.conf'), 'utf8')],
      ['plugin.conf', readFileSync(join(CONFIG, 'plugin.conf'), 'utf8')],
      ['maps/overworld.conf', readFileSync(join(CONFIG, 'maps', 'overworld.conf'), 'utf8')],
    ] as const) {
      for (const line of text.split('\n')) {
        if (line.trimStart().startsWith('#')) continue;
        expect(line, file).not.toMatch(/token|secret|password|api[_-]?key/i);
      }
    }
  });
});
