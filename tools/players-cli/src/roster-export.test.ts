import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliDeps, REPO_ROOT, runCli } from './cli.ts';
import { RosterError } from './roster.ts';
import { buildRoster, encodeRoster, MAX_ROSTER_BYTES, writeRosterExport } from './roster-export.ts';

const SHARD = `sovereign:
  players:
    - { player_id: ag-jason-01, life_id: ag_jason_01, name: Jason }
    - { player_id: ag-ana-01, life_id: ag_ana_01, name: Ana }
`;

/** Source trees a model can read. The roster file must never be named in them. */
const MODEL_FACING = ['threshold', 'golem/src', 'contract'];

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'roster-export-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Fakes for the CLI: only the shard and the output are used; every other side effect throws if reached. */
function rosterDeps(shard: string, repoRoot: string, lines: string[]): CliDeps {
  const unused = async (): Promise<never> => {
    throw new Error('not used by roster export');
  };
  return {
    readShard: async () => shard,
    readSkin: unused,
    readKey: unused,
    upload: unused,
    openBucket: unused,
    natsUrl: () => undefined,
    now: () => new Date('2026-11-27T00:00:00Z'),
    repoRoot,
    out: (line) => lines.push(line),
  };
}

async function sourceFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) found.push(...(await sourceFiles(path)));
    else if (/\.(ts|tsx|js|mjs|cjs|json|ya?ml|md)$/.test(entry.name)) found.push(path);
  }
  return found;
}

describe('roster export', () => {
  it('the roster is a flat object of string to string', () => {
    const roster = buildRoster(SHARD);
    expect({ ...roster }).toEqual({ Jason: 'ag_jason_01', Ana: 'ag_ana_01' });
    for (const value of Object.values(roster)) expect(typeof value).toBe('string');
    const parsed: unknown = JSON.parse(encodeRoster(roster));
    expect(parsed).toEqual({ Jason: 'ag_jason_01', Ana: 'ag_ana_01' });
  });

  it('a nested value is refused', () => {
    const nestedLife = `sovereign:\n  players:\n    - { player_id: ag-jason-01, life_id: { deep: x }, name: Jason }\n`;
    const nestedName = `sovereign:\n  players:\n    - { player_id: ag-jason-01, life_id: ag_jason_01, name: { first: J } }\n`;
    expect(() => buildRoster(nestedLife)).toThrow(RosterError);
    expect(() => buildRoster(nestedName)).toThrow(RosterError);
    const nestedValue = { Jason: { life: 'ag_jason_01' } } as unknown as Record<string, string>;
    expect(() => encodeRoster(nestedValue)).toThrow(RosterError);
  });

  it('a duplicate name is refused, never silently dropped', () => {
    const dup = `sovereign:\n  players:\n    - { player_id: ag-jason-01, life_id: ag_jason_01, name: Jason }\n    - { player_id: ag-jason-02, life_id: ag_jason_02, name: Jason }\n`;
    expect(() => buildRoster(dup)).toThrow(RosterError);
  });

  it('oversize roster is refused', () => {
    expect(() => encodeRoster({ [`${'a'.repeat(MAX_ROSTER_BYTES)}`]: 'ag_jason_01' })).toThrow(
      RosterError,
    );
  });

  it('the cap is exact at 16384 bytes', () => {
    const base = Buffer.byteLength(encodeRoster({ '': 'ag_jason_01' }));
    const exact = encodeRoster({ ['a'.repeat(MAX_ROSTER_BYTES - base)]: 'ag_jason_01' });
    expect(Buffer.byteLength(exact)).toBe(MAX_ROSTER_BYTES);
    expect(() =>
      encodeRoster({ ['a'.repeat(MAX_ROSTER_BYTES - base + 1)]: 'ag_jason_01' }),
    ).toThrow(RosterError);
  });

  it('a successful write leaves only the target file', async () => {
    const body = encodeRoster(buildRoster(SHARD));
    const target = join(dir, 'roster.json');
    await writeRosterExport(target, body);
    expect(await readFile(target, 'utf8')).toBe(body);
    expect(await readdir(dir)).toEqual(['roster.json']);
  });

  it('failed write leaves no file', async () => {
    const body = encodeRoster(buildRoster(SHARD));
    const target = join(dir, 'roster.json');
    const failingRename = async (): Promise<void> => {
      throw new Error('disk full');
    };
    await expect(writeRosterExport(target, body, failingRename)).rejects.toThrow(RosterError);
    expect(await readdir(dir)).toEqual([]);
    const missingDir = join(dir, 'missing', 'roster.json');
    await expect(writeRosterExport(missingDir, body)).rejects.toThrow(RosterError);
    expect(await readdir(dir)).toEqual([]);
  });

  it('roster export writes the flat roster to a new file outside the repo', async () => {
    const lines: string[] = [];
    const repo = join(dir, 'repo');
    const target = join(dir, 'roster.json');
    const code = await runCli(
      ['roster', 'export', '--out', target],
      rosterDeps(SHARD, repo, lines),
    );
    expect(code).toBe(0);
    const written: unknown = JSON.parse(await readFile(target, 'utf8'));
    expect(written).toEqual({ Jason: 'ag_jason_01', Ana: 'ag_ana_01' });
    expect(lines.join('\n')).not.toContain('Jason');
  });

  it('roster export refuses a path inside the repo and an existing file', async () => {
    const lines: string[] = [];
    const repo = join(dir, 'repo');
    const inRepo = join(repo, 'roster.json');
    expect(
      await runCli(['roster', 'export', '--out', inRepo], rosterDeps(SHARD, repo, lines)),
    ).toBe(1);
    expect(await readdir(dir)).toEqual([]);
    const existing = join(dir, 'roster.json');
    await writeFile(existing, 'keep', 'utf8');
    expect(
      await runCli(['roster', 'export', '--out', existing], rosterDeps(SHARD, repo, lines)),
    ).toBe(1);
    expect(await readFile(existing, 'utf8')).toBe('keep');
  });

  it('roster export without --out prints usage', async () => {
    const lines: string[] = [];
    expect(await runCli(['roster', 'export'], rosterDeps(SHARD, dir, lines))).toBe(2);
    expect(lines.join('\n')).toContain('roster export --out');
  });

  it('oversize roster is refused through the CLI and writes no file', async () => {
    const lines: string[] = [];
    const huge = `sovereign:\n  players:\n    - { player_id: ag-jason-01, life_id: ag_jason_01, name: ${'a'.repeat(MAX_ROSTER_BYTES)} }\n`;
    const target = join(dir, 'roster.json');
    const code = await runCli(
      ['roster', 'export', '--out', target],
      rosterDeps(huge, join(dir, 'repo'), lines),
    );
    expect(code).toBe(1);
    expect(await readdir(dir)).toEqual([]);
  });

  it('no model-facing source names roster.json', async () => {
    for (const sub of MODEL_FACING) {
      for (const file of await sourceFiles(join(REPO_ROOT, sub))) {
        expect(await readFile(file, 'utf8'), file).not.toContain('roster.json');
      }
    }
  });
});
