import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Static checks on the committed BlueMap config (C1-09). The config is read as text: each setting
// is a top-level `key: value` line, and `#` lines are comments. A setting that is missing, or that
// is not the exact value, fails the test.

const CONFIG = join(import.meta.dirname, '..', 'config');
const LOOPBACK = '127.0.0.1';

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
  it('keeps the integrated webserver off, so nothing listens on any interface', () => {
    // BlueMap 5.29 has no bind-address option. With the server on, its bind would be all
    // interfaces. The only accepted state is off. If it is ever on, it must be loopback.
    const enabled = value('webserver.conf', 'enabled');
    if (enabled === 'true') {
      expect(value('webserver.conf', 'ip')).toBe(LOOPBACK);
    } else {
      expect(enabled).toBe('false');
    }
  });

  it('keeps the config free of IPv4 addresses (no node or network address)', () => {
    expect(allConfigText()).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
  });
});

describe('BlueMap config: terrain only, no agent markers', () => {
  it('keeps live player markers off', () => {
    expect(value('plugin.conf', 'live-player-markers')).toBe('false');
  });

  it('keeps Mojang skin downloads off', () => {
    expect(value('plugin.conf', 'skin-download')).toBe('false');
  });

  it('renders only the overworld, with no marker sets', () => {
    const maps = readdirSync(join(CONFIG, 'maps'));
    expect(maps).toEqual(['overworld.conf']);
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

describe('BlueMap config: no Mojang download and no secret', () => {
  it('keeps accept-download false in the repo', () => {
    expect(value('core.conf', 'accept-download')).toBe('false');
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
