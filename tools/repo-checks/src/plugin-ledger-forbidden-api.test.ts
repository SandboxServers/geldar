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
      'sendRichMessage',
      'sendPlainMessage',
      'kickPlayer',
      'performCommand',
      'chat(',
      'createBossBar',
      'getScoreboardManager',
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

  // The orchestrator accepted this one allowance: the `geldar.broadcast` event-name constant (that file, that name,
  // that line text). Any other hit, or a broadcast call in that file, still fails.
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

  it.each([
    ['a double-quoted key', `${GOOD_YML}"commands":\n  x: {}\n`, 'declares commands:'],
    ['a single-quoted key', `${GOOD_YML}'permissions':\n  x: {}\n`, 'declares permissions:'],
    ['a quoted key with other case', `${GOOD_YML}"Commands": {}\n`, 'declares Commands:'],
  ])('catches %s', (_label, text, message) => {
    expect(scanPluginYml(text)).toEqual([expect.stringContaining(message)]);
  });

  it('catches a forbidden word used as a key at any depth', () => {
    const nested = GOOD_YML.replace(
      'description: Server statistics.',
      'description:\n  commands: x',
    );
    expect(scanPluginYml(nested)).toEqual([expect.stringContaining('declares commands:')]);
    const deeper = `${GOOD_YML}extra:\n  a:\n    - b: 1\n      loadbefore: [x]\n`;
    expect(scanPluginYml(deeper)).toEqual([
      expect.stringContaining('declares loadbefore:'),
      expect.stringContaining('key extra: is not allowed'),
    ]);
  });

  it('reads flow mappings: the allowed form passes and a hidden commands key fails', () => {
    const good =
      "{name: Ledger, main: a.B, version: '1', api-version: '26.1', description: x, softdepend: [spark]}\n";
    expect(scanPluginYml(good)).toEqual([]);
    const bad = '{name: Ledger, main: a.B, commands: {a: {}}}\n';
    expect(scanPluginYml(bad)).toEqual([expect.stringContaining('declares commands:')]);
    const quoted = '{name: Ledger, "permissions": {a: {}}}\n';
    expect(scanPluginYml(quoted)).toEqual([expect.stringContaining('declares permissions:')]);
  });

  it.each([
    ['an anchor', `${GOOD_YML}x-base: &a {b: 1}\n`, 'an anchor'],
    ['an anchor that an alias would use', `base: &a {commands: {}}\n${GOOD_YML}`, 'an anchor'],
    ['a merge key', `${GOOD_YML}<<: {commands: {}}\n`, 'a merge key'],
    ['tab indentation', `${GOOD_YML}description:\n\tcommands: x\n`, 'tab indentation'],
    ['two documents', `${GOOD_YML}---\n${GOOD_YML}`, '2 documents'],
    ['an empty file', '', '0 documents'],
    ['a list at the top level', '- a\n- b\n', 'not a mapping'],
    ['a complex key', `${GOOD_YML}? [a, b]\n: c\n`, 'not a plain scalar'],
    ['a duplicate key', `${GOOD_YML}name: Other\n`, 'parse error'],
    ['broken syntax', 'name: [Ledger\nmain: a.B\n', 'parse error'],
  ])('fails closed on %s', (_label, text, message) => {
    expect(scanPluginYml(text)).toEqual([expect.stringContaining('cannot be checked')]);
    expect(scanPluginYml(text)[0]).toContain(message);
  });

  it('fails closed on an alias that stands in for a forbidden section', () => {
    const text = `${GOOD_YML}x-a: &a {c: 1}\ncommands: *a\n`;
    const out = scanPluginYml(text);
    expect(out).toEqual([expect.stringContaining('cannot be checked')]);
  });

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
