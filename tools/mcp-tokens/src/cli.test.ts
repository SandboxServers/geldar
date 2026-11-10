import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type Env, type Io, PASSWORD_REWRITE_WARNING, parseArgs, run } from './cli.ts';
import { PEPPER_FILE, REPO_ROOT } from './secret-files.ts';

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function harness(): Promise<{ io: Io; out: string[]; err: string[]; secretDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'mcp-tokens-cli-'));
  dirs.push(root);
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { out: (line) => out.push(line), err: (line) => err.push(line) },
    out,
    err,
    secretDir: join(root, 'secrets'),
  };
}

/** The environment for a test: the temporary secret directory and no database. */
function envOf(h: { secretDir: string }): Env {
  return {
    secretDir: h.secretDir,
    shardFile: join(h.secretDir, '..', 'phase0.yaml'),
    connect: () => Promise.reject(new Error('no database in this test')),
  };
}

/** A session that knows the statements `token mint` sends: one active player, no tokens yet. */
function tokenSession(calls: string[]): Env['connect'] {
  return async () => ({
    query: async (text: string) => {
      calls.push(text);
      if (text.startsWith('SELECT status')) return { rows: [{ status: 'active' }] };
      if (text.includes('count(*)')) return { rows: [{ n: 0 }] };
      return { rows: [] };
    },
    end: async () => {},
  });
}

describe('token commands', () => {
  it('mints to a file and keeps the token out of stdout and stderr (canary scan)', async () => {
    const h = await harness();
    const out = join(h.secretDir, '..', 'jo.env');
    await run(['init'], h.io, envOf(h));
    const calls: string[] = [];
    const env = { ...envOf(h), connect: tokenSession(calls) };
    expect(await run(['token', 'mint', 'ag-jo-01', '--out', out], h.io, env)).toBe(0);
    const token = (await readFile(out, 'utf8')).match(/gmcp-[0-9a-f]{64}/)?.[0] ?? '';
    expect(token).toMatch(/^gmcp-/);
    const printed = [...h.out, ...h.err].join('\n');
    expect(printed).toMatch(/minted tk_/);
    expect(printed).not.toContain(token);
    expect(printed).not.toContain('gmcp-');
    expect(calls.join('\n')).not.toContain(token);
  });

  it('refuses an --out path inside the repo before it connects to the database', async () => {
    const h = await harness();
    const inside = join(REPO_ROOT, 'leak.env');
    const env = { ...envOf(h), connect: () => Promise.reject(new Error('must not connect')) };
    expect(await run(['token', 'mint', 'ag-jo-01', '--out', inside], h.io, env)).toBe(1);
    expect(h.err.join('\n')).toContain('outside the repo');
    expect(h.err.join('\n')).not.toContain('must not connect');
  });
});

describe('parseArgs', () => {
  it('splits positional words from flags, and takes a value after a value flag', () => {
    const parsed = parseArgs(['owner', 'add', 'jo', '--cap', '20', '--all']);
    expect(parsed.positional).toEqual(['owner', 'add', 'jo']);
    expect(parsed.flags.get('--cap')).toBe('20');
    expect(parsed.flags.get('--all')).toBe(true);
  });

  it('refuses a value flag with no value', () => {
    expect(() => parseArgs(['token', 'mint', 'ag-jo-01', '--out'])).toThrow('--out needs a value');
  });
});

describe('init', () => {
  it('creates the secret files and prints their paths, never their contents', async () => {
    const h = await harness();
    const code = await run(['init'], h.io, envOf(h));
    expect(code).toBe(0);
    expect(h.out.map((line) => line.split(' ')[0])).toEqual(['created', 'created']);
    const pepper = (await readFile(join(h.secretDir, PEPPER_FILE), 'utf8')).trim();
    expect(h.out.join('\n')).not.toContain(pepper);
    expect(h.err).toEqual([]);
  });

  it('refuses --force without --i-understand and leaves the pepper alone', async () => {
    const h = await harness();
    await run(['init'], h.io, envOf(h));
    const before = await readFile(join(h.secretDir, PEPPER_FILE), 'utf8');
    const code = await run(['init', '--force'], h.io, envOf(h));
    expect(code).toBe(1);
    expect(h.err.join('\n')).toContain('--i-understand');
    expect(await readFile(join(h.secretDir, PEPPER_FILE), 'utf8')).toBe(before);
  });

  it('re-creates the files with --force --i-understand', async () => {
    const h = await harness();
    await run(['init'], h.io, envOf(h));
    const before = await readFile(join(h.secretDir, PEPPER_FILE), 'utf8');
    const code = await run(['init', '--force', '--i-understand'], h.io, envOf(h));
    expect(code).toBe(0);
    expect(h.out.slice(-2).map((line) => line.split(' ')[0])).toEqual(['replaced', 'replaced']);
    expect(await readFile(join(h.secretDir, PEPPER_FILE), 'utf8')).not.toBe(before);
  });

  it('warns after --force that the database role password must be set, and not before', async () => {
    const h = await harness();
    await run(['init'], h.io, envOf(h));
    expect(h.err).toEqual([]);
    const code = await run(['init', '--force', '--i-understand'], h.io, envOf(h));
    expect(code).toBe(0);
    expect(h.err).toEqual([PASSWORD_REWRITE_WARNING]);
    expect(h.err.join('\n')).toContain(
      'db migrate --set-role-password geldar_mcp --password-file compose/secrets/postgres-mcp.txt',
    );
  });

  it('prints the usage and exits 2 for an unknown command', async () => {
    const h = await harness();
    expect(await run(['frobnicate'], h.io, envOf(h))).toBe(2);
    expect(h.err.join('\n')).toContain('usage:');
  });

  it('dispatches persona export and refuses a missing --out before reading the draft', async () => {
    const h = await harness();
    expect(await run(['persona', 'export', 'zack'], h.io, envOf(h))).toBe(1);
    expect(h.err.join('\n')).toContain('--out is required');
  });
});

/** A session that answers the retire statements: the player is active and owns life ag_jo_01. */
function retireSession(): Env['connect'] {
  return async () => ({
    query: async (text: string) => {
      if (text.startsWith('UPDATE mcp_players'))
        return { rows: [{ player_id: 'ag-jo-01', life_id: 'ag_jo_01' }] };
      return { rows: [] };
    },
    end: async () => {},
  });
}

describe('player retire', () => {
  it('retires the player, then removes its life and prints each step', async () => {
    const h = await harness();
    const removed: string[] = [];
    const env = {
      ...envOf(h),
      connect: retireSession(),
      removeLife: async (lifeId: string) => {
        removed.push(lifeId);
        return ['registry key ag_jo_01: deleted', 'whitelist ag_jo_01: removed'];
      },
    };
    expect(await run(['player', 'retire', 'ag-jo-01'], h.io, env)).toBe(0);
    expect(removed).toEqual(['ag_jo_01']);
    expect(h.out).toEqual([
      'player ag-jo-01: retire',
      'registry key ag_jo_01: deleted',
      'whitelist ag_jo_01: removed',
    ]);
  });

  it('still retires and exits 0 when NATS and RCON are down, and prints the manual commands', async () => {
    const h = await harness();
    const env = {
      ...envOf(h),
      connect: retireSession(),
      removeLife: async () => [
        'registry key ag_jo_01: not deleted (NATS is unreachable); run: nats kv del geldar-life-registry ag_jo_01',
        'whitelist ag_jo_01: not removed (connect ECONNREFUSED); run: docker compose -f compose/phase0.yml exec paper rcon-cli whitelist remove ag_jo_01',
      ],
    };
    expect(await run(['player', 'retire', 'ag-jo-01'], h.io, env)).toBe(0);
    expect(h.out.join('\n')).toContain('nats kv del geldar-life-registry ag_jo_01');
    expect(h.out.join('\n')).toContain('rcon-cli whitelist remove ag_jo_01');
    expect(h.err).toEqual([]);
  });

  it('exits 0 when the removal itself throws, and names the life for the manual steps', async () => {
    const h = await harness();
    const env = {
      ...envOf(h),
      connect: retireSession(),
      removeLife: async () => {
        throw new Error('ECONNREFUSED');
      },
    };
    expect(await run(['player', 'retire', 'ag-jo-01'], h.io, env)).toBe(0);
    expect(h.out).toEqual([
      'player ag-jo-01: retire',
      'life ag_jo_01: removal failed (ECONNREFUSED)',
    ]);
  });
});
