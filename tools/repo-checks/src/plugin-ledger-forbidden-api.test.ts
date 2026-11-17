import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LISTS,
  patternFor,
  type ScanLists,
  scanJava,
  scanPluginYml,
  scanTree,
} from './plugin-ledger-forbidden-api.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const GOOD_YML =
  'name: Ledger\nmain: a.B\nversion: "1"\napi-version: "26.1"\ndescription: Server statistics.\nsoftdepend: [spark]\n';
const CLEAN_JAVA = 'package a;\nclass Clean { long tick() { return 1L; } }\n';

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'pt18a-'));
  temps.push(dir);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

/** A source line that uses `name` the way the list means it: a call for `name(` entries, else a method call. */
const useOf = (name: string): string =>
  `x.${name.endsWith('(') ? name : `${name}(`}1);`.replace('((', '(');

describe('forbidden list shape', () => {
  it('holds the card names and matches whole words only', () => {
    for (const name of [
      'sendMessage',
      'dispatchCommand',
      'setCancelled',
      'getHostAddress',
      'purge',
    ]) {
      expect(LISTS.forbiddenNames).toContain(name);
    }
    expect(LISTS.allow.map((entry) => `${entry.name}@${entry.file.split('/').pop()}`)).toEqual([
      'broadcast@Names.java',
    ]);
    expect(patternFor('broadcast').test('x.broadcast(1)')).toBe(true);
    expect(patternFor('broadcast').test('rebroadcasting')).toBe(false);
    expect(patternFor('spawn(').test('w.spawn (e)')).toBe(true);
    expect(patternFor('spawn(').test('respawn(e)')).toBe(false);
    expect(patternFor('spawn(').test('int spawn;')).toBe(false);
  });
});

describe('scanJava', () => {
  it.each(LISTS.forbiddenNames)('flags %s', (name) => {
    const hits = scanJava('A.java', `class A { void f() { ${useOf(name)} } }`);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain(`forbidden API ${name}`);
  });

  it('fails a fixture with player.sendMessage( and passes a clean one', () => {
    const bad = fixture({
      'plugin/ledger/src/main/java/A.java':
        'class A { void f(P player) { player.sendMessage("hi"); } }\n',
      'plugin/ledger/src/main/resources/plugin.yml': GOOD_YML,
    });
    expect(scanTree(bad)).toEqual([expect.stringContaining('A.java:1: forbidden API sendMessage')]);
    const clean = fixture({
      'plugin/ledger/src/main/java/A.java': CLEAN_JAVA,
      'plugin/ledger/src/main/resources/plugin.yml': GOOD_YML,
    });
    expect(scanTree(clean)).toEqual([]);
  });

  it('scans ledger-core too, and reports the line number', () => {
    const dir = fixture({
      'plugin/ledger-core/src/main/java/B.java':
        'class B {\n  void f(S s) { s.getHostAddress(); }\n}\n',
      'plugin/ledger/src/main/resources/plugin.yml': GOOD_YML,
    });
    expect(scanTree(dir)).toEqual([
      expect.stringContaining('B.java:2: forbidden API getHostAddress'),
    ]);
  });

  it('honours an allow-list entry for that file, name and line text only', () => {
    const lists: ScanLists = {
      ...LISTS,
      allow: [{ file: 'A.java', name: 'shutdown(', text: 'ok1', reason: 'test' }],
    };
    const text = 'e.shutdown(); // ok1\ne.shutdown();\ne.purge(); // ok1';
    expect(scanJava('A.java', text, lists)).toEqual([
      expect.stringContaining('A.java:2: forbidden API shutdown('),
      expect.stringContaining('A.java:3: forbidden API purge'),
    ]);
    expect(scanJava('B.java', text, lists)).toHaveLength(3);
  });

  it('allows the Names.java broadcast constant but still flags a broadcast call there', () => {
    const file = LISTS.allow[0]?.file ?? '';
    expect(scanJava(file, 'String B = "geldar.broadcast";')).toEqual([]);
    expect(scanJava(file, 'Bukkit.broadcast(m);')).toHaveLength(1);
  });
});

describe('scanPluginYml', () => {
  it('accepts the allowed keys', () => {
    expect(scanPluginYml(GOOD_YML)).toEqual([]);
  });

  it.each([
    'commands:\n  x: {}',
    'permissions:\n  x: {}',
    'loadbefore: [a]',
    'libraries: [a]',
    'load: STARTUP',
  ])('rejects %s', (extra) => {
    expect(scanPluginYml(`${GOOD_YML}${extra}\n`)).toHaveLength(1);
  });

  it.each(['Telemetry', 'TraceBox', 'otel', 'Metrics', 'Monitor'])(
    'rejects the name %s',
    (name) => {
      expect(scanPluginYml(GOOD_YML.replace('Ledger', name))).toEqual([
        expect.stringContaining('contains'),
      ]);
    },
  );

  it('fails the tree when plugin.yml is missing or declares commands', () => {
    const missing = fixture({ 'plugin/ledger/src/main/java/A.java': CLEAN_JAVA });
    expect(scanTree(missing)).toEqual([expect.stringContaining('cannot be read')]);
    const bad = fixture({
      'plugin/ledger/src/main/resources/plugin.yml': `${GOOD_YML}commands:\n  x: {}\n`,
    });
    expect(scanTree(bad)).toEqual([expect.stringContaining('declares commands:')]);
  });
});

describe('the real tree', () => {
  it('has no forbidden API in plugin/ledger or plugin/ledger-core and a plain plugin.yml', () => {
    expect(scanTree(ROOT)).toEqual([]);
  });
});
