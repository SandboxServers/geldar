import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NEOFORGE_LISTS,
  type NeoForgeScanLists,
  scanModsToml,
  scanNeoForgeTree,
} from './neoforge-ledger-forbidden-api.ts';
import { scanJava } from './plugin-ledger-forbidden-api.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TOML_PATH = NEOFORGE_LISTS.modsToml.path;
const GOOD_TOML =
  'modLoader = "javafml"\n[[mods]]\nmodId = "ledger"\ndisplayName = "Geldar Ledger"\n';
const CLEAN_JAVA = 'package a;\nclass Clean { long tick() { return 1L; } }\n';
const JAVA_PATH = 'neoforge-ledger/src/main/java/A.java';

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'ptn10-'));
  temps.push(dir);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const asScan = (lists: NeoForgeScanLists) => ({ ...lists, pluginYml: undefined as never });
const useOf = (name: string): string =>
  `x.${name.endsWith('(') ? name : `${name}(`}1);`.replace('((', '(');

describe('NeoForge forbidden list shape', () => {
  it('names the sinks for chat, signs, books, files, secrets and world actions', () => {
    for (const name of [
      'sendSystemMessage',
      'ServerChatEvent',
      'SignText',
      'WrittenBookContent',
      'readString(',
      'System.getenv(',
      'OTEL_EXPORTER_OTLP_HEADERS',
      'setBlock',
      'teleportTo',
      'RegisterCommandsEvent',
      'CustomPacketPayload',
    ]) {
      expect(NEOFORGE_LISTS.forbiddenNames).toContain(name);
    }
    expect(new Set(NEOFORGE_LISTS.forbiddenNames).size).toBe(NEOFORGE_LISTS.forbiddenNames.length);
  });
});

describe('scanJava with the NeoForge list', () => {
  it.each(NEOFORGE_LISTS.forbiddenNames)('flags %s', (name) => {
    const hits = scanJava(
      'A.java',
      `class A { void f() { ${useOf(name)} } }`,
      asScan(NEOFORGE_LISTS),
    );
    expect(hits.map((hit) => hit.split('forbidden API ')[1])).toContain(name);
  });

  it('does not flag look-alike names', () => {
    const text = 'class A { int respawn; void f() { rekill(1); mySetBlockish(); } }';
    expect(scanJava('A.java', text, asScan(NEOFORGE_LISTS))).toEqual([]);
  });

  it('fails a tree with player.sendSystemMessage( and passes a clean one', () => {
    const bad = fixture({
      [JAVA_PATH]: 'class A { void f(P p) { p.sendSystemMessage(c); } }\n',
      [TOML_PATH]: GOOD_TOML,
    });
    expect(scanNeoForgeTree(bad)).toEqual([
      expect.stringContaining('A.java:1: forbidden API sendSystemMessage'),
    ]);
    const clean = fixture({ [JAVA_PATH]: CLEAN_JAVA, [TOML_PATH]: GOOD_TOML });
    expect(scanNeoForgeTree(clean)).toEqual([]);
  });

  it('honours an allow entry for that file, name and line text only', () => {
    const lists: NeoForgeScanLists = {
      ...NEOFORGE_LISTS,
      allow: [{ file: 'A.java', name: 'readString(', text: 'ok1', reason: 'test' }],
    };
    const text = 'Files.readString(p); // ok1\nFiles.readString(p);';
    expect(scanJava('A.java', text, asScan(lists))).toEqual([
      expect.stringContaining('A.java:2: forbidden API readString('),
    ]);
  });
});

describe('the LedgerMod config allowance', () => {
  it('allows the config read in LedgerMod.java only, on that line text only', () => {
    const file = NEOFORGE_LISTS.allow[0]?.file ?? '';
    const lists = asScan(NEOFORGE_LISTS);
    expect(scanJava(file, 'try (InputStream in = Files.newInputStream(file)) {', lists)).toEqual(
      [],
    );
    expect(scanJava(file, 'Files.newInputStream(other);', lists)).toHaveLength(1);
    expect(scanJava('B.java', 'Files.newInputStream(file);', lists)).toHaveLength(1);
  });
});

describe('the StatsFileReader byte-channel allowance', () => {
  const reader =
    'neoforge-ledger/src/main/java/dev/geldar/ledger/neoforge/players/StatsFileReader.java';
  const open =
    'try (FileChannel ch = FileChannel.open(file, StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS)) {';
  const lists = asScan(NEOFORGE_LISTS);

  it.each([
    'FileChannel.open(p, StandardOpenOption.READ);',
    'AsynchronousFileChannel.open(p);',
    'Files.newByteChannel(p);',
    'FileSystems.getDefault().provider().newFileChannel(p, s);',
    'Channels.newInputStream(ch);',
  ])('flags %s in another file', (line) => {
    expect(scanJava('B.java', line, lists).length).toBeGreaterThan(0);
  });

  it('allows exactly the one open call in StatsFileReader.java', () => {
    expect(scanJava(reader, open, lists)).toEqual([]);
    expect(
      scanJava(reader, 'FileChannel.open(other, StandardOpenOption.READ);', lists),
    ).toHaveLength(1);
    expect(scanJava(reader, 'Files.newByteChannel(file);', lists)).toHaveLength(1);
  });

  it('does not cover another file with the same line', () => {
    expect(scanJava('neoforge-ledger/src/main/java/B.java', open, lists)).toHaveLength(1);
  });
});
describe('scanModsToml', () => {
  it('accepts the plain file', () => {
    expect(scanModsToml(GOOD_TOML)).toEqual([]);
  });

  it.each(['[[mixins]]', '[[accessTransformers]]', '[ mixins ]'])('rejects %s', (header) => {
    expect(scanModsToml(`${GOOD_TOML}${header}\n`)).toEqual([expect.stringContaining('declares')]);
  });

  it.each(['Telemetry', 'TraceBox', 'otel', 'Metrics', 'Monitor'])(
    'rejects the name %s',
    (name) => {
      expect(scanModsToml(GOOD_TOML.replace('Geldar Ledger', name))).toEqual([
        expect.stringContaining('contains'),
      ]);
    },
  );

  it('fails the tree when mods.toml is missing', () => {
    const dir = fixture({ [JAVA_PATH]: CLEAN_JAVA });
    expect(scanNeoForgeTree(dir)).toEqual([expect.stringContaining('cannot be read')]);
  });
});

describe('the real tree', () => {
  it('has no forbidden API in neoforge-ledger and a plain neoforge.mods.toml', () => {
    expect(scanNeoForgeTree(ROOT)).toEqual([]);
  });
});
