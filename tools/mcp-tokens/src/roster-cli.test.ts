import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type Env, type Io, run } from './cli.ts';

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** Runs `roster` with the given arguments; the connection records every statement it is sent. */
async function roster(args: string[]) {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-tokens-roster-'));
  dirs.push(dir);
  const statements: string[] = [];
  const lines: string[] = [];
  const io: Io = { out: (line) => lines.push(line), err: (line) => lines.push(line) };
  const env: Env = {
    secretDir: join(dir, 'secrets'),
    shardFile: join(dir, 'phase0.yaml'),
    connect: async () => ({
      query: async (text: string) => {
        statements.push(text);
        return { rows: [] };
      },
      end: async () => {},
    }),
  };
  const code = await run(['roster', ...args], io, env);
  return { code, statements, lines, dir };
}

describe('roster command', () => {
  it('adds a name for an owner with max_agents 1 by default', async () => {
    const result = await roster(['add', 'Jason', '--owner', 'alice']);
    expect(result.code, result.lines.join('\n')).toBe(0);
    expect(result.statements.some((s) => s.startsWith('INSERT INTO mcp_roster'))).toBe(true);
    expect(result.lines).toEqual(['added Jason to the roster of alice (max_agents 1)']);
  });

  it('refuses --max 5 before the database is reached', async () => {
    const result = await roster(['add', 'Jason', '--owner', 'alice', '--max', '5']);
    expect(result.code).toBe(1);
    expect(result.lines.join('\n')).toContain('max_agents');
    expect(result.statements).toEqual([]);
  });

  it('seeds from a shard file, reading sovereign.players names', async () => {
    const result = await roster(['seed', '--owner', 'alice', '--from', 'shard.yaml']);
    expect(result.code).toBe(1);
    await writeFile(
      join(result.dir, 'shard.yaml'),
      'sovereign:\n  players:\n    - { player_id: ag-jason-01, life_id: ag_jason_01, name: Jason }\n',
    );
    const seeded = await roster([
      'seed',
      '--owner',
      'alice',
      '--from',
      join(result.dir, 'shard.yaml'),
    ]);
    expect(seeded.code, seeded.lines.join('\n')).toBe(0);
    expect(seeded.lines[0]).toContain('seeded 0 of 1');
    expect(seeded.statements).toContain('BEGIN');
    expect(seeded.statements).toContain('COMMIT');
  });
});
