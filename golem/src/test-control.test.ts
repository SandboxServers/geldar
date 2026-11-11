import type { Dirent } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseItems, TestControl } from './test-control.ts';

/** The whole-tree scans read every file under src; vitest's 5 s default is too tight under parallel load on Windows. */
const SCAN_TIMEOUT_MS = 30_000;

/** The RCON layer: only the bench, the arena and the live fixtures may reach it. */
const FORBIDDEN = [
  join(import.meta.dirname, 'rcon.ts'),
  join(import.meta.dirname, 'test-control.ts'),
];

/** Files and directories under src that are allowed to reach the RCON layer. */
const CONTROL_USERS = [
  ...['bench', 'arena.ts', 'rcon.ts', 'test-control.ts'].map((name) =>
    join(import.meta.dirname, name),
  ),
  // Threat-model rule 9 and the WM-08 packet: the player host whitelists a life over RCON before connect.
  join(import.meta.dirname, 'players', 'whitelist.ts'),
  join(import.meta.dirname, 'players', 'main.ts'),
  // The operator removal path (`players down`, `adam stop`, `mcp-tokens retire`) removes the whitelist
  // entry over RCON with the same password file; see players/life-removal.ts.
  join(import.meta.dirname, 'players', 'life-removal.ts'),
];

/** What actions must not reach: the RCON layer, the arena builder and the bench. */
async function forbiddenForActions(): Promise<string[]> {
  const bench = await tsFilesUnder(join(import.meta.dirname, 'bench'));
  return [...FORBIDDEN, join(import.meta.dirname, 'arena.ts'), ...bench];
}

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

/** The file access the import scan uses. The real disk is the default; the in-process cases inject a map. */
interface ImportFiles {
  isFile(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
}

/** The real disk. Whether a path is an existing regular file: a directory or a missing path is not. */
const realFiles: ImportFiles = {
  async isFile(path) {
    try {
      return (await stat(path)).isFile();
    } catch {
      return false;
    }
  },
  readText: (path) => readFile(path, 'utf8'),
};

/** The RCON and arena sources. The scan stops at them before reading, so they need only exist. */
const KNOWN_TARGETS = [...FORBIDDEN, join(import.meta.dirname, 'arena.ts')];

/**
 * An in-memory ImportFiles for the in-process cases. The paths in `texts` are files, and so are the
 * RCON and arena sources. Any other path is missing or a directory.
 */
function memoryFiles(texts: Record<string, string>): ImportFiles {
  const isKnown = (path: string) => Object.hasOwn(texts, path) || KNOWN_TARGETS.includes(path);
  return {
    isFile: async (path) => isKnown(path),
    readText: async (path) => {
      if (!Object.hasOwn(texts, path)) throw new Error(`ENOENT: ${path}`);
      return texts[path] ?? '';
    },
  };
}

/**
 * The file a relative import names. Tries the specifier as written, then `.js` read as `.ts`, then
 * `.ts` added, then a directory's `index.ts`. Undefined when none of them is a file.
 */
async function resolveImport(
  file: string,
  spec: string,
  files: ImportFiles = realFiles,
): Promise<string | undefined> {
  const base = resolve(dirname(file), spec);
  const candidates = [base, base.replace(/\.js$/, '.ts'), `${base}.ts`, join(base, 'index.ts')];
  for (const candidate of candidates) {
    if (await files.isFile(candidate)) return candidate;
  }
  return undefined;
}

/** The files a source file imports by relative path (`from`, bare and dynamic) that resolve. */
async function relativeImports(file: string, files: ImportFiles = realFiles): Promise<string[]> {
  const text = await files.readText(file);
  const specs = text.matchAll(/\b(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g);
  const found: string[] = [];
  for (const match of specs) {
    const target = await resolveImport(file, match[1] ?? '', files);
    if (target !== undefined) found.push(target);
  }
  return found;
}

/** Follows imports from `start` through any file reached, and returns the first forbidden one. */
async function reachesForbidden(
  start: string,
  forbidden: string[] = FORBIDDEN,
  files: ImportFiles = realFiles,
): Promise<string | undefined> {
  const seen = new Set<string>([start]);
  const queue = [start];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    for (const next of await relativeImports(file, files)) {
      if (forbidden.includes(next)) return next;
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

  it('resets a recipe book with the advancement revoke and then the recipe take', async () => {
    const { control, sent } = fakeControl();
    await control.recipeReset('GolemRecipe');
    expect(sent).toEqual([
      'advancement revoke GolemRecipe from minecraft:recipes/root',
      'recipe take GolemRecipe *',
    ]);
    await control.recipeGive('GolemRecipe');
    expect(sent.at(-1)).toBe('recipe give GolemRecipe *');
    await expect(control.recipeReset('a b')).rejects.toThrow(RangeError);
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
    expect(() => control.setblock(0, 320, 0, 'stone')).toThrow(RangeError);
    expect(() => control.setblock(0, -65, 0, 'stone')).toThrow(RangeError);
    expect(() => control.setblock(0, 319, 0, 'stone')).not.toThrow();
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

  it('throws on a reply the server folded to "..." instead of dropping the later stacks', () => {
    const reply =
      'The block has the following block data: [{Slot: 0b, id: "minecraft:cobblestone", count: 64}, {Slot:...';
    expect(() => parseItems(reply)).toThrow(/truncated/);
  });

  it('chestItems reads slot by slot when the whole reply is folded', async () => {
    const sent: string[] = [];
    const head = 'The block has the following block data: ';
    const control = new TestControl({
      command: async (cmd: string) => {
        sent.push(cmd);
        if (cmd.endsWith(' Items'))
          return `${head}[{Slot: 0b, id: "minecraft:iron_pickaxe", count: 1, components: {...`;
        if (cmd.endsWith('Items[{Slot:0b}].id')) return `${head}"minecraft:iron_pickaxe"`;
        if (cmd.endsWith('Items[{Slot:0b}].count')) return `${head}1`;
        if (cmd.endsWith('Items[{Slot:3b}].id')) return `${head}"minecraft:stick"`;
        if (cmd.endsWith('Items[{Slot:3b}].count')) return `${head}2`;
        return 'Found no elements matching Items';
      },
    });
    const totals = await control.chestItems(1, 2, 3);
    expect([...totals]).toEqual([
      ['iron_pickaxe', 1],
      ['stick', 2],
    ]);
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

  it(
    'keeps RCON and test control out of every src file except the bench, arena and control files',
    async () => {
      const files = (await tsFilesUnder(import.meta.dirname)).filter(
        (file) =>
          !file.endsWith('.test.ts') &&
          !CONTROL_USERS.some((user) => file === user || file.startsWith(user + sep)),
      );
      expect(files.length).toBeGreaterThan(10);
      for (const file of files) {
        expect(await reachesForbidden(file), file).toBeUndefined();
      }
    },
    SCAN_TIMEOUT_MS,
  );

  it(
    'lets only the player and removal files whitelist over RCON, and no other players file',
    async () => {
      const players = join(import.meta.dirname, 'players');
      const admitted = CONTROL_USERS.filter((user) => user.startsWith(players + sep)).sort();
      expect(admitted).toEqual([
        join(players, 'life-removal.ts'),
        join(players, 'main.ts'),
        join(players, 'whitelist.ts'),
      ]);
      const reaching: string[] = [];
      for (const file of await tsFilesUnder(players)) {
        if (!file.endsWith('.test.ts') && (await reachesForbidden(file)) !== undefined) {
          reaching.push(file);
        }
      }
      expect(reaching.sort()).toEqual(admitted);
    },
    SCAN_TIMEOUT_MS,
  );

  it(
    'keeps the arena and the bench out of src/actions as well',
    async () => {
      const forbidden = await forbiddenForActions();
      const actions = await tsFilesUnder(join(import.meta.dirname, 'actions'));
      for (const file of actions.filter((f) => !f.endsWith('.test.ts'))) {
        expect(await reachesForbidden(file, forbidden), file).toBeUndefined();
      }
    },
    SCAN_TIMEOUT_MS,
  );

  it('catches a file that imports the RCON layer, directly, dynamically or transitively', async () => {
    // A fixture root that is never created on disk: the cases read only the in-memory files below.
    const dir = resolve('guard-fixture');
    const control = relative(dir, join(import.meta.dirname, 'test-control'))
      .split(sep)
      .join('/');
    const arena = relative(dir, join(import.meta.dirname, 'arena'))
      .split(sep)
      .join('/');
    const files = memoryFiles({
      [join(dir, 'direct.ts')]: `import { TestControl } from '${control}';\n`,
      [join(dir, 'dynamic.ts')]: `const m = await import('${control}');\n`,
      [join(dir, 'middle.ts')]: "export * from './direct';\n",
      [join(dir, 'transitive.ts')]: "import './middle';\n",
      [join(dir, 'arena-user.ts')]: `import '${arena}';\n`,
    });
    for (const name of ['direct', 'dynamic', 'transitive']) {
      expect(await reachesForbidden(join(dir, `${name}.ts`), FORBIDDEN, files), name).toBe(
        join(import.meta.dirname, 'test-control.ts'),
      );
    }
    // Actions may not reach the arena either (it imports the control itself).
    expect(
      await reachesForbidden(join(dir, 'arena-user.ts'), await forbiddenForActions(), files),
    ).toBe(join(import.meta.dirname, 'arena.ts'));
  });

  it('resolves directory, .js and extensionless import specifiers without a file-system error', async () => {
    const dir = resolve('guard-fixture');
    // `./sub` is named but is not a file (it is a directory in the old disk version); it resolves to nothing.
    const files = memoryFiles({
      [join(dir, 'plain.ts')]: 'export const plain = 1;\n',
      [join(dir, 'ok.ts')]: "import './sub';\nimport './plain.js';\nimport './plain';\n",
    });
    expect(await reachesForbidden(join(dir, 'ok.ts'), FORBIDDEN, files)).toBeUndefined();
    // The forbidden rcon.ts, named without its extension or with .js, is still found.
    const rcon = relative(dir, join(import.meta.dirname, 'rcon'))
      .split(sep)
      .join('/');
    for (const spec of [rcon, `${rcon}.js`]) {
      const leak = memoryFiles({ [join(dir, 'leak.ts')]: `import '${spec}';\n` });
      expect(await reachesForbidden(join(dir, 'leak.ts'), FORBIDDEN, leak)).toBe(
        join(import.meta.dirname, 'rcon.ts'),
      );
    }
  });
});
