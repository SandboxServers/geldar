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
