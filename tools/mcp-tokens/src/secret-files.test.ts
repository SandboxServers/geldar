import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  initSecretFiles,
  isInsideRepo,
  PASSWORD_FILE,
  PEPPER_FILE,
  REPO_ROOT,
  readPepper,
  restrictToOwner,
} from './secret-files.ts';

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-tokens-secrets-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('initSecretFiles', () => {
  it('creates the pepper and the Postgres password files when they are missing', async () => {
    const dir = await tempDir();
    const reports = await initSecretFiles(dir, { force: false });
    expect(reports).toEqual([
      { file: PEPPER_FILE, action: 'created' },
      { file: PASSWORD_FILE, action: 'created' },
    ]);
    expect(await readFile(join(dir, PEPPER_FILE), 'utf8')).toMatch(/^[0-9a-f]{64}\n$/);
    expect(await readFile(join(dir, PASSWORD_FILE), 'utf8')).toMatch(/^[0-9a-f]{64}\n$/);
  });

  it('keeps existing files without --force, so a second init invalidates nothing', async () => {
    const dir = await tempDir();
    await initSecretFiles(dir, { force: false });
    const before = await readFile(join(dir, PEPPER_FILE), 'utf8');
    const reports = await initSecretFiles(dir, { force: false });
    expect(reports.map((report) => report.action)).toEqual(['kept', 'kept']);
    expect(await readFile(join(dir, PEPPER_FILE), 'utf8')).toBe(before);
  });

  it('re-creates both files with force, replacing the pepper', async () => {
    const dir = await tempDir();
    await initSecretFiles(dir, { force: false });
    const before = await readFile(join(dir, PEPPER_FILE), 'utf8');
    const reports = await initSecretFiles(dir, { force: true, random: () => Buffer.alloc(32, 7) });
    expect(reports.map((report) => report.action)).toEqual(['replaced', 'replaced']);
    const after = await readFile(join(dir, PEPPER_FILE), 'utf8');
    expect(after).toBe(`${'07'.repeat(32)}\n`);
    expect(after).not.toBe(before);
  });

  it('gives the secret files owner-only permissions where the platform enforces them', async () => {
    const dir = await tempDir();
    await initSecretFiles(dir, { force: false });
    await initSecretFiles(dir, { force: true });
    if (process.platform === 'win32') return;
    for (const file of [PEPPER_FILE, PASSWORD_FILE]) {
      const mode = (await stat(join(dir, file))).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });
});

describe('readPepper', () => {
  it('reads the pepper without its trailing newline', async () => {
    const dir = await tempDir();
    await initSecretFiles(dir, { force: false, random: () => Buffer.alloc(32, 1) });
    expect(await readPepper(dir)).toBe('01'.repeat(32));
  });

  it('refuses a pepper file too short to be a key, without echoing it', async () => {
    const dir = await tempDir();
    await initSecretFiles(dir, { force: false });
    await writeFile(join(dir, PEPPER_FILE), 'short\n');
    await expect(readPepper(dir)).rejects.toThrow('too short');
  });
});

describe('restrictToOwner', () => {
  const IMPLIED = '/inheritance:r /grant:r steve:F';
  const IMPLIED_DIRECTORY = '/inheritance:r /grant:r steve:(OI)(CI)F';

  it('runs icacls on win32 with inheritance off and full control for the current user only', async () => {
    const calls: string[][] = [];
    await restrictToOwner('C:\\secrets\\x.txt', {
      platform: 'win32',
      user: 'steve',
      run: async (args) => {
        calls.push([...args]);
      },
    });
    expect(calls).toEqual([['C:\\secrets\\x.txt', '/inheritance:r', '/grant:r', 'steve:F']]);
  });

  it('grants a directory the inherit flags, so files created in it get the same access', async () => {
    const dir = await tempDir();
    const file = join(dir, 'x.txt');
    await writeFile(file, 'x');
    const calls: string[][] = [];
    const run = async (args: readonly string[]) => {
      calls.push([...args]);
    };
    await restrictToOwner(dir, { platform: 'win32', user: 'steve', run });
    await restrictToOwner(file, { platform: 'win32', user: 'steve', run });
    expect(calls).toEqual([
      [dir, '/inheritance:r', '/grant:r', 'steve:(OI)(CI)F'],
      [file, '/inheritance:r', '/grant:r', 'steve:F'],
    ]);
  });

  it('never runs icacls on other platforms', async () => {
    const calls: string[][] = [];
    for (const platform of ['linux', 'darwin'] as const) {
      await restrictToOwner('/secrets/x.txt', {
        platform,
        user: 'steve',
        run: async (args) => {
          calls.push([...args]);
        },
      });
    }
    expect(calls).toEqual([]);
  });

  it('runs icacls for the directory and then each secret file on win32, and not elsewhere', async () => {
    const dir = await tempDir();
    const calls: string[][] = [];
    const acl = {
      user: 'steve',
      run: async (args: readonly string[]) => {
        calls.push([...args]);
      },
    };
    await initSecretFiles(dir, { force: false, acl: { ...acl, platform: 'win32' } });
    expect(calls.map((call) => call[0])).toEqual([
      dir,
      join(dir, PEPPER_FILE),
      join(dir, PASSWORD_FILE),
    ]);
    const [directoryCall, ...fileCalls] = calls;
    expect(directoryCall?.slice(1).join(' ')).toBe(IMPLIED_DIRECTORY);
    expect(fileCalls.every((call) => call.slice(1).join(' ') === IMPLIED)).toBe(true);
    calls.length = 0;
    await initSecretFiles(dir, { force: true, acl: { ...acl, platform: 'linux' } });
    expect(calls).toEqual([]);
  });

  it('never fails the command when icacls fails, and never logs the pepper', async () => {
    const dir = await tempDir();
    const warnings: string[] = [];
    const reports = await initSecretFiles(dir, {
      force: false,
      random: () => Buffer.alloc(32, 7),
      acl: {
        platform: 'win32',
        user: 'steve',
        run: async () => {
          throw new Error('icacls exited 5');
        },
        warn: (line) => warnings.push(line),
      },
    });
    expect(reports.map((report) => report.action)).toEqual(['created', 'created']);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.join('\n')).toContain(dir);
    expect(warnings.join('\n')).not.toContain('07'.repeat(32));
  });

  it('keeps the default permissions with a warning when the account name is unknown', async () => {
    const warnings: string[] = [];
    const calls: string[][] = [];
    await restrictToOwner('C:\\secrets\\x.txt', {
      platform: 'win32',
      user: '',
      run: async (args) => {
        calls.push([...args]);
      },
      warn: (line) => warnings.push(line),
    });
    expect(calls).toEqual([]);
    expect(warnings).toHaveLength(1);
  });
});

describe('isInsideRepo', () => {
  it('refuses a path inside the repo, including the repo root itself', () => {
    expect(isInsideRepo(resolve(REPO_ROOT, 'tokens', 'alice.env'), REPO_ROOT)).toBe(true);
    expect(isInsideRepo(REPO_ROOT, REPO_ROOT)).toBe(true);
  });

  it('accepts a path outside the repo, including a sibling whose name starts the same way', () => {
    expect(isInsideRepo(resolve(REPO_ROOT, '..', 'elsewhere.env'), REPO_ROOT)).toBe(false);
    expect(isInsideRepo(`${REPO_ROOT}-other/x.env`, REPO_ROOT)).toBe(false);
  });
});
