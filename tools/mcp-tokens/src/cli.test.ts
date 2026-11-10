import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type Env, type Io, parseArgs, run } from './cli.ts';
import { PEPPER_FILE } from './secret-files.ts';

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

  it('prints the usage and exits 2 for an unknown command', async () => {
    const h = await harness();
    expect(await run(['frobnicate'], h.io, envOf(h))).toBe(2);
    expect(h.err.join('\n')).toContain('usage:');
  });
});
