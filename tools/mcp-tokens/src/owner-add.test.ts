import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type Env, type Io, run } from './cli.ts';

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** A shard file with a sovereign block; each cap key is written only when its value is given. */
async function shardFile(ownerCapDefault?: string, ownerCapOwner?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-tokens-owner-add-'));
  dirs.push(dir);
  const file = join(dir, 'phase0.yaml');
  const cap = ownerCapDefault === undefined ? '' : `  owner_cap_default: ${ownerCapDefault}\n`;
  const owner = ownerCapOwner === undefined ? '' : `  owner_cap_owner: ${ownerCapOwner}\n`;
  await writeFile(
    file,
    `shard: phaseunit\nidentity_mode: watched\nsovereign:\n  allowed: true\n  budget:\n    cap_credits: 240\n${cap}${owner}`,
  );
  return file;
}

/** Runs `owner add` with the given arguments; returns the exit code, the output and the cap values inserted. */
async function ownerAdd(args: string[], file: string) {
  const inserted: unknown[][] = [];
  const lines: string[] = [];
  const io: Io = { out: (line) => lines.push(line), err: (line) => lines.push(line) };
  const env: Env = {
    secretDir: join(dirname(file), 'secrets'),
    shardFile: file,
    connect: async () => ({
      query: async (text: string, values?: unknown[]) => {
        if (text.startsWith('INSERT INTO mcp_owners')) inserted.push(values ?? []);
        return { rows: [] };
      },
      end: async () => {},
    }),
  };
  const code = await run(['owner', 'add', ...args], io, env);
  return { code, inserted, lines };
}

describe('owner add is idempotent', () => {
  it('a second run for the same id reports exists, exits 0, and leaves the row unchanged', async () => {
    const file = await shardFile('5', '20');
    const owners = new Map<string, number>();
    const inserts: unknown[][] = [];
    const lines: string[] = [];
    const io: Io = { out: (line) => lines.push(line), err: (line) => lines.push(line) };
    const env: Env = {
      secretDir: join(dirname(file), 'secrets'),
      shardFile: file,
      connect: async () => ({
        query: async (text: string, values?: unknown[]) => {
          if (text.startsWith('SELECT owner_id FROM mcp_owners')) {
            const id = String(values?.[0]);
            return { rows: owners.has(id) ? [{ owner_id: id }] : [] };
          }
          if (text.startsWith('INSERT INTO mcp_owners')) {
            const id = String(values?.[0]);
            // The primary key: a second insert for the same id is a database error.
            if (owners.has(id)) throw new Error('duplicate key value violates unique constraint');
            owners.set(id, Number(values?.[1]));
            inserts.push(values ?? []);
          }
          return { rows: [] };
        },
        end: async () => {},
      }),
    };
    expect(await run(['owner', 'add', 'jo', '--cap', '5'], io, env)).toBe(0);
    expect(lines.join('\n')).toContain('cannot sign in');
    expect(lines.join('\n')).not.toContain('exists');
    lines.length = 0;
    expect(await run(['owner', 'add', 'jo', '--cap', '7'], io, env)).toBe(0);
    expect(lines.join('\n')).toContain('exists');
    expect(inserts).toEqual([['jo', 5]]);
    expect(owners.get('jo')).toBe(5);
  });

  it('a database error other than the conflict still exits non-zero', async () => {
    const file = await shardFile('5', '20');
    const lines: string[] = [];
    const io: Io = { out: (line) => lines.push(line), err: (line) => lines.push(line) };
    const env: Env = {
      secretDir: join(dirname(file), 'secrets'),
      shardFile: file,
      connect: async () => ({
        query: async () => {
          throw new Error('database is down');
        },
        end: async () => {},
      }),
    };
    expect(await run(['owner', 'add', 'jo'], io, env)).not.toBe(0);
    expect(lines.join('\n')).toContain('database is down');
  });

  it('an INSERT failure after a SELECT that found nothing exits non-zero and never says exists', async () => {
    const file = await shardFile('5', '20');
    const lines: string[] = [];
    const io: Io = { out: (line) => lines.push(line), err: (line) => lines.push(line) };
    const env: Env = {
      secretDir: join(dirname(file), 'secrets'),
      shardFile: file,
      connect: async () => ({
        query: async (text: string) => {
          if (text.startsWith('INSERT INTO mcp_owners')) throw new Error('check constraint failed');
          return { rows: [] };
        },
        end: async () => {},
      }),
    };
    expect(await run(['owner', 'add', 'jo'], io, env)).not.toBe(0);
    expect(lines.join('\n')).toContain('check constraint failed');
    expect(lines.join('\n')).not.toContain('exists');
  });

  it('a lost race (INSERT hits the primary key after an empty SELECT) exits non-zero, not exists', async () => {
    const file = await shardFile('5', '20');
    const lines: string[] = [];
    const io: Io = { out: (line) => lines.push(line), err: (line) => lines.push(line) };
    const env: Env = {
      secretDir: join(dirname(file), 'secrets'),
      shardFile: file,
      connect: async () => ({
        query: async (text: string) => {
          if (text.startsWith('INSERT INTO mcp_owners'))
            throw new Error('duplicate key value violates unique constraint');
          return { rows: [] };
        },
        end: async () => {},
      }),
    };
    expect(await run(['owner', 'add', 'jo'], io, env)).not.toBe(0);
    expect(lines.join('\n')).toContain('duplicate key');
    expect(lines.join('\n')).not.toContain('exists');
  });
});

describe('owner add takes its cap from the shard file', () => {
  it('uses owner_cap_default when --cap is not given', async () => {
    const result = await ownerAdd(['jo'], await shardFile('5', '20'));
    expect(result.code, result.lines.join('\n')).toBe(0);
    expect(result.inserted).toEqual([['jo', 5]]);
  });

  it('refuses, and names the key, when owner_cap_default is missing and --cap is not given', async () => {
    const result = await ownerAdd(['jo'], await shardFile(undefined, '20'));
    expect(result.code).not.toBe(0);
    expect(result.lines.join('\n')).toContain('sovereign.owner_cap_default');
    expect(result.inserted).toEqual([]);
  });

  it('lets --cap override the shard file', async () => {
    const result = await ownerAdd(['jo', '--cap', '20'], await shardFile('5', '20'));
    expect(result.code, result.lines.join('\n')).toBe(0);
    expect(result.inserted).toEqual([['jo', 20]]);
  });

  it('works with --cap when owner_cap_default is missing', async () => {
    const result = await ownerAdd(['jo', '--cap', '20'], await shardFile(undefined, '20'));
    expect(result.code, result.lines.join('\n')).toBe(0);
    expect(result.inserted).toEqual([['jo', 20]]);
  });

  it('refuses a --cap above owner_cap_owner before the database sees it', async () => {
    const result = await ownerAdd(['jo', '--cap', '21'], await shardFile('3', '20'));
    expect(result.code).not.toBe(0);
    expect(result.lines.join('\n')).toContain('owner_cap_owner');
    expect(result.inserted).toEqual([]);
  });

  it('refuses a --cap when owner_cap_owner is missing, and names the key', async () => {
    const result = await ownerAdd(['jo', '--cap', '5'], await shardFile('3'));
    expect(result.code).not.toBe(0);
    expect(result.lines.join('\n')).toContain('sovereign.owner_cap_owner');
    expect(result.inserted).toEqual([]);
  });

  it('refuses an owner_cap_default out of range before the database sees it', async () => {
    const result = await ownerAdd(['jo'], await shardFile('51', '20'));
    expect(result.code).not.toBe(0);
    expect(result.inserted).toEqual([]);
  });
});
