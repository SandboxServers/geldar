import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// BM-16: the public map serves a pinned settings.json (GET /settings.json, plugins/bluemap/web/geldar-settings.json)
// instead of the copy BlueMap rewrites on every start. BM-16c: the pinned file is hand-copied into the webroot as
// geldar-settings.json (no compose mount), and Caddy reads it from /srv. These checks tie the pinned file to the BlueMap
// version, the map configs, the Caddy handler, the compose file and the config bundle, so a drift fails the suite.
const ROOT = join(import.meta.dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const PINNED_PATH = 'plugins/bluemap/web/geldar-settings.json';
const KEYS = [
  'version',
  'useCookies',
  'defaultToFlatView',
  'resolutionDefault',
  'minZoomDistance',
  'maxZoomDistance',
  'hiresSliderMax',
  'hiresSliderDefault',
  'hiresSliderMin',
  'lowresSliderMax',
  'lowresSliderDefault',
  'lowresSliderMin',
  'mapDataRoot',
  'liveDataRoot',
  'clientDecompression',
  'maps',
  'scripts',
  'styles',
];

const pinned = JSON.parse(read(PINNED_PATH)) as Record<string, unknown>;
const caddy = read('compose/bluemap-web/Caddyfile');

// The body of a Caddy handle block, by its matcher line (the body ends at the tab-indented closing brace).
const handleBlock = (matcher: string): string | undefined => {
  const escaped = matcher.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return new RegExp(`handle ${escaped} \\{([\\s\\S]*?)\\n\\t\\}`).exec(caddy)?.[1];
};

describe('pinned settings.json: content', () => {
  it('has exactly the BlueMap 5.29 keys the live file had, in order', () => {
    expect(Object.keys(pinned)).toEqual(KEYS);
  });

  it('pins the BlueMap version that bluemap.lock.json and known-keys.json record', () => {
    const known = JSON.parse(read('plugins/bluemap/known-keys.json')) as { bluemap: string };
    const lock = JSON.parse(read('plugins/bluemap/bluemap.lock.json')) as { version: string };
    expect(pinned.version).toBe('5.29');
    expect(pinned.version).toBe(known.bluemap);
    expect(pinned.version).toBe(lock.version);
  });

  it('reads map data from maps/ and turns client decompression off (the Caddy @gz and @live rules depend on both)', () => {
    expect(pinned.mapDataRoot).toBe('maps');
    expect(pinned.liveDataRoot).toBe('maps');
    expect(pinned.clientDecompression).toBe(false);
  });

  it('lists exactly the map configs (plugins/bluemap/config/maps), as a set', () => {
    const names = readdirSync(join(ROOT, 'plugins/bluemap/config/maps'))
      .filter((f) => f.endsWith('.conf'))
      .map((f) => f.replace(/\.conf$/, ''))
      .sort();
    expect([...(pinned.maps as string[])].sort()).toEqual(names);
    expect(names).toEqual(['end', 'nether', 'overworld']);
  });

  it('lists the maps in the order of their sorting: value in config/maps', () => {
    const dir = join(ROOT, 'plugins/bluemap/config/maps');
    const maps = readdirSync(dir)
      .filter((f) => f.endsWith('.conf'))
      .map((f) => {
        const match = /^\s*sorting\s*:\s*(\d+)\s*$/m.exec(readFileSync(join(dir, f), 'utf8'));
        return { name: f.replace(/\.conf$/, ''), sorting: match ? Number(match[1]) : Number.NaN };
      });
    expect(maps.every((m) => Number.isFinite(m.sorting))).toBe(true);
    const inOrder = [...maps].sort((a, b) => a.sorting - b.sorting).map((m) => m.name);
    expect(pinned.maps).toEqual(inOrder);
  });

  it('loads the chat panel and the dial as scripts, in that order', () => {
    expect(pinned.scripts).toEqual(['assets/geldar-chat.js', 'assets/geldar-sky.js']);
  });

  it('loads the stylesheet as the only style', () => {
    expect(pinned.styles).toEqual(['assets/geldar.css']);
  });

  it('has no secret, token, password or IPv4 address', () => {
    const text = read(PINNED_PATH);
    expect(text).not.toMatch(/secret|token|password|api[_-]?key/i);
    expect(text).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
  });
});

describe('pinned settings.json: every script and style is served', () => {
  for (const entry of [...(pinned.scripts as string[]), ...(pinned.styles as string[])]) {
    it(`${entry} has a Caddy handle block and a file in web/`, () => {
      const file = entry.replace(/^assets\//, '');
      expect(handleBlock(`/${entry}`)).toContain(`rewrite * /${file}`);
      expect(read(`plugins/bluemap/web/${file}`).length).toBeGreaterThan(0);
    });
  }
});

describe('settings.json handler in Caddy', () => {
  const block = handleBlock('/settings.json') ?? '';

  it('reads the pinned copy from the webroot at /srv (no mount)', () => {
    expect(block).not.toBe('');
    expect(block).toContain('root * /srv');
    expect(block).not.toContain('/etc/caddy');
    expect(block).toContain('file_server');
  });

  it('falls back to BlueMap settings.json when the pinned copy is missing (try_files, never 404)', () => {
    expect(block).toContain('try_files /geldar-settings.json /settings.json');
    // The fallback is inside the same route, so it cannot be skipped by a second rewrite in one group.
    expect(block).not.toContain('rewrite * /settings.json');
  });

  it('answers as application/json and never caches it', () => {
    expect(block).toContain('header Content-Type "application/json"');
    expect(block).toContain('header Cache-Control no-cache');
  });

  it('sits before the generic handle, so it is not caught by the webroot', () => {
    const at = caddy.indexOf('handle /settings.json {');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(caddy.indexOf('\n\thandle {\n'));
  });

  it('stays behind the GET and HEAD rule (POST is 405)', () => {
    expect(caddy).toContain('@not_allowed not method GET HEAD');
  });
});

describe('settings.json: wiring', () => {
  it('compose does not mount the pinned file: the node never had that mount (BM-16c)', () => {
    expect(read('compose/colo.yml')).not.toContain('geldar-settings.json');
  });

  it('the compose fixture carries no bind for the pinned file', () => {
    expect(read('deploy/test/fixtures/colo-default-config.yml')).not.toContain(
      'geldar-settings.json',
    );
  });

  it('the config bundle ships the pinned file: it is the source of the hand copy into the webroot', () => {
    expect(read('deploy/genesis/config-bundle.list')).toContain(
      '\nplugins/bluemap/web/geldar-settings.json\n',
    );
  });
});
