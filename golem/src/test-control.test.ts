import type { Dirent } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseItems, TestControl } from './test-control.ts';

/** The files this guard keeps out of src/actions, by absolute path. */
const FORBIDDEN = [
  join(import.meta.dirname, 'rcon.ts'),
  join(import.meta.dirname, 'test-control.ts'),
];

/** Every .ts file under a directory, at any depth. A missing directory has no files. */
async function tsFilesUnder(dir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await tsFilesUnder(path)));
    else if (entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
}

/** Whether a path is an existing regular file. A directory or a missing path is not. */
async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * The file a relative import names. Tries the specifier as written, then `.js` read as `.ts`, then
 * `.ts` added, then a directory's `index.ts`. Undefined when none of them is a file.
 */
async function resolveImport(file: string, spec: string): Promise<string | undefined> {
  const base = resolve(dirname(file), spec);
  const candidates = [base, base.replace(/\.js$/, '.ts'), `${base}.ts`, join(base, 'index.ts')];
  for (const candidate of candidates) {
    if (await isFile(candidate)) return candidate;
  }
  return undefined;
}

/** The files a source file imports by relative path (`from`, bare and dynamic) that resolve. */
async function relativeImports(file: string): Promise<string[]> {
  const text = await readFile(file, 'utf8');
  const specs = text.matchAll(/\b(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g);
  const found: string[] = [];
  for (const match of specs) {
    const target = await resolveImport(file, match[1] ?? '');
    if (target !== undefined) found.push(target);
  }
  return found;
}

/** Follows imports from `start` through any file reached, and returns the first forbidden one. */
async function reachesForbidden(start: string): Promise<string | undefined> {
  const seen = new Set<string>([start]);
  const queue = [start];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    for (const next of await relativeImports(file)) {
      if (FORBIDDEN.includes(next)) return next;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return undefined;
}

/** A fake command source that records every string and answers with the reply it is given. */
function fakeControl(reply = 'ok') {
  const sent: string[] = [];
  const control = new TestControl({
    command: async (cmd: string) => {
      sent.push(cmd);
      return reply;
    },
  });
  return { control, sent };
}

describe('TestControl', () => {
  it('builds the tp command from validated arguments', async () => {
    const { control, sent } = fakeControl();
    await control.tp('GolemSmoke', 1, 2, 3);
    expect(sent).toEqual(['tp GolemSmoke 1 2 3']);
  });

  it('rejects player names with spaces, separators, or the wrong length', async () => {
    const { control, sent } = fakeControl();
    for (const name of ['a b', 'x;y', 'ab', 'a'.repeat(17)]) {
      expect(() => control.kill(name)).toThrow(RangeError);
    }
    expect(sent).toEqual([]);
  });

  it('rejects item ids with uppercase or separators', () => {
    const { control } = fakeControl();
    expect(() => control.give('GolemSmoke', 'Stone', 1)).toThrow(RangeError);
    expect(() => control.give('GolemSmoke', 'stone;kill', 1)).toThrow(RangeError);
    expect(() => control.give('GolemSmoke', 'stone', 6401)).toThrow(RangeError);
  });

  it('rejects coordinates out of range', () => {
    const { control } = fakeControl();
    expect(() => control.setblock(0, 321, 0, 'stone')).toThrow(RangeError);
    expect(() => control.setblock(30_000_001, 0, 0, 'stone')).toThrow(RangeError);
    expect(() => control.setblock(0, 0, 0.5, 'stone')).toThrow(RangeError);
  });

  it('fills a 20,181-block box in one command', async () => {
    const { control, sent } = fakeControl('Successfully filled 20181 blocks');
    await control.fill({ x: 0, y: 200, z: 0 }, { x: 30, y: 220, z: 30 }, 'air');
    expect(sent).toEqual(['fill 0 200 0 30 220 30 air']);
  });

  it('splits a 39,401-block box into two y-slabs', async () => {
    const { control, sent } = fakeControl('ok');
    await control.fill({ x: 0, y: 200, z: 0 }, { x: 30, y: 240, z: 30 }, 'air');
    expect(sent).toEqual(['fill 0 200 0 30 233 30 air', 'fill 0 234 0 30 240 30 air']);
  });

  it('parses a two-entry chest reply in either field order', () => {
    const a =
      '[{Slot: 0b, id: "minecraft:cobblestone", count: 10}, {id: "minecraft:stick", Slot: 1b, count: 3}]';
    const totals = parseItems(`The block has the following block data: ${a}`);
    expect([...totals]).toEqual([
      ['cobblestone', 10],
      ['stick', 3],
    ]);
  });

  it('returns an empty map for "Found no elements" and an empty list', () => {
    expect(parseItems('Found no elements').size).toBe(0);
    expect(parseItems('800, 200, 800 has the following block data: []').size).toBe(0);
  });

  it('throws on replies that are not block data, so an unloaded chest is not an empty one', () => {
    expect(() => parseItems('That position is not loaded')).toThrow(/chest read failed/);
    expect(() => parseItems('The target block is not a block entity')).toThrow(/chest read failed/);
  });

  it('counts an item whose components compound holds braces and a nested count', () => {
    const reply =
      'The block has the following block data: [{Slot: 0b, id: "minecraft:diamond_sword", ' +
      'count: 1, components: {"minecraft:custom_data": {count: 50, note: "a } brace"}}}]';
    expect([...parseItems(reply)]).toEqual([['diamond_sword', 1]]);
  });

  it('reads the entry count when a nested compound with its own count comes first', () => {
    const reply =
      'The block has the following block data: [{Slot: 0b, components: ' +
      '{"minecraft:custom_data": {count: 50}}, id: "minecraft:stick", count: 2}]';
    expect([...parseItems(reply)]).toEqual([['stick', 2]]);
  });

  it('throws when the only count is inside a nested compound', () => {
    const reply =
      'The block has the following block data: [{Slot: 0b, id: "minecraft:stick", ' +
      'components: {count: 5}}]';
    expect(() => parseItems(reply)).toThrow(/chest entry has no id or count/);
  });

  it('does not let a brace inside a quoted string before id and count end the entry', () => {
    const reply =
      'The block has the following block data: [{Slot: 0b, note: "a } brace", ' +
      'id: "minecraft:stick", count: 4}]';
    expect([...parseItems(reply)]).toEqual([['stick', 4]]);
  });

  it('chestItems sends the data get command and parses the reply', async () => {
    const reply =
      'The block has the following block data: [{Slot: 0b, id: "minecraft:dirt", count: 2}]';
    const { control, sent } = fakeControl(reply);
    const items = await control.chestItems(1, 2, 3);
    expect(sent).toEqual(['data get block 1 2 3 Items']);
    expect(items.get('dirt')).toBe(2);
  });

  it('chestItems throws when the position is not loaded', async () => {
    const { control } = fakeControl('That position is not loaded');
    await expect(control.chestItems(20_000_000, 64, 20_000_000)).rejects.toThrow(/not loaded/);
  });

  it('whitelistAdd resolves for "Added" and "already whitelisted" and throws otherwise', async () => {
    await expect(
      fakeControl('Added GolemSmoke to the whitelist').control.whitelistAdd('GolemSmoke'),
    ).resolves.toBeUndefined();
    await expect(
      fakeControl('Player is already whitelisted').control.whitelistAdd('GolemSmoke'),
    ).resolves.toBeUndefined();
    await expect(fakeControl('Unknown command').control.whitelistAdd('GolemSmoke')).rejects.toThrow(
      /unexpected reply/,
    );
  });

  it('fill throws a RangeError for a layer over 32,768 blocks and sends nothing', async () => {
    // Without the guard the slab height is 0 and fill loops forever: the fake stops it after 50.
    const sent: string[] = [];
    const control = new TestControl({
      command: async (cmd: string) => {
        sent.push(cmd);
        if (sent.length > 50) throw new Error('fill did not stop');
        return 'ok';
      },
    });
    // 200 by 200 is a 40,000-block layer, over the 32,768 limit.
    await expect(
      control.fill({ x: 0, y: 200, z: 0 }, { x: 199, y: 205, z: 199 }, 'air'),
    ).rejects.toThrow(RangeError);
    expect(sent).toEqual([]);
  });

  it('gamerule rejects a name that is not snake_case and sends nothing', () => {
    const { control, sent } = fakeControl();
    expect(() => control.gamerule('x; stop')).toThrow(RangeError);
    expect(() => control.gamerule('advance_time', true)).not.toThrow();
    expect(sent).toEqual(['gamerule advance_time true']);
  });

  it('keeps RCON and test control out of src/actions, directly or through any import', async () => {
    const actions = await tsFilesUnder(join(import.meta.dirname, 'actions'));
    for (const file of actions) {
      expect(await reachesForbidden(file), file).toBeUndefined();
    }
  });

  it('resolves directory, .js and extensionless import specifiers without a file-system error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'guard-'));
    try {
      await mkdir(join(dir, 'sub'));
      await writeFile(join(dir, 'plain.ts'), 'export const plain = 1;\n');
      await writeFile(
        join(dir, 'ok.ts'),
        "import './sub';\nimport './plain.js';\nimport './plain';\n",
      );
      expect(await reachesForbidden(join(dir, 'ok.ts'))).toBeUndefined();
      // The forbidden rcon.ts, named without its extension or with .js, is still found.
      const rcon = relative(dir, join(import.meta.dirname, 'rcon'))
        .split(sep)
        .join('/');
      for (const spec of [rcon, `${rcon}.js`]) {
        await writeFile(join(dir, 'leak.ts'), `import '${spec}';\n`);
        expect(await reachesForbidden(join(dir, 'leak.ts'))).toBe(
          join(import.meta.dirname, 'rcon.ts'),
        );
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
