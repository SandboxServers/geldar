import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ExportIo, exportPersona, insideGitWorkTree } from './persona-export.ts';
import { REPO_ROOT } from './secret-files.ts';

interface Fields {
  identity?: string;
  quirk?: string;
  goals?: string;
}

/** A one-ranger draft in the approved format. */
function draftWith({
  identity = 'Zack Taylor, a joker with a big heart.',
  quirk = 'Zack dances after each task.',
  goals = 'Keep the spirits up when things go bad.',
}: Fields): string {
  return [
    '# Rangers',
    '',
    '## Zack: the Black Ranger',
    '',
    `- **Identity:** ${identity}`,
    `- **Quirk:** ${quirk}`,
    `- **Goals:** ${goals}`,
    '',
  ].join('\n');
}

describe('persona export', () => {
  let root: string;
  let source: string;
  let out: string;
  let acl: string[][];
  let stdout: string[];
  let stderr: string[];
  let io: ExportIo;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'persona-export-'));
    source = join(root, 'draft.md');
    out = join(root, 'launcher', 'zack');
    acl = [];
    stdout = [];
    stderr = [];
    io = { out: (line) => stdout.push(line), err: (line) => stderr.push(line) };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /**
   * The options for Zack's export. The ACL step records its calls instead of running icacls, and the
   * git walk is stubbed out: the temp directory sits under C:\, which holds a .git on this machine.
   */
  const options = (extra: Partial<Parameters<typeof exportPersona>[0]> = {}) => ({
    name: 'zack',
    out,
    source,
    inWorkTree: () => false,
    acl: {
      platform: 'win32' as const,
      user: 'tester',
      run: async (args: readonly string[]) => {
        acl.push([...args]);
      },
      warn: () => {},
    },
    ...extra,
  });

  it('refuses an --out inside a git work tree', async () => {
    await mkdir(join(root, 'repo', '.git'), { recursive: true });
    await writeFile(source, draftWith({}));
    const inside = join(root, 'repo', 'sub', 'out');
    expect(insideGitWorkTree(inside)).toBe(true);
    // The real walk: the .git directory made above is the nearest one, so the refusal comes from it.
    await expect(
      exportPersona(options({ out: inside, inWorkTree: undefined }), io),
    ).rejects.toThrow(/git work tree/);
    expect(existsSync(join(inside, 'memory'))).toBe(false);
  });

  it('refuses an --out inside this repo', async () => {
    await writeFile(source, draftWith({}));
    const inside = join(REPO_ROOT, 'persona-export-test-out');
    await expect(exportPersona(options({ out: inside }), io)).rejects.toThrow();
    expect(existsSync(join(inside, 'memory'))).toBe(false);
  });

  it('writes memory/identity.md and memory/goals.md, LF only, with the owner-only ACL', async () => {
    await writeFile(source, draftWith({}));
    await exportPersona(options(), io);
    const identity = join(out, 'memory', 'identity.md');
    const goals = join(out, 'memory', 'goals.md');
    expect(await readFile(identity, 'utf8')).toBe(
      'Zack Taylor, a joker with a big heart.\n\n## Quirk\n\nZack dances after each task.\n',
    );
    expect(await readFile(goals, 'utf8')).toBe('Keep the spirits up when things go bad.\n');
    expect(acl.map((args) => args[0])).toEqual([join(out, 'memory'), identity, goals]);
    expect(acl[1]).toEqual([identity, '/inheritance:r', '/grant:r', 'tester:F']);
    expect(stdout.join('\n')).not.toContain('Zack Taylor');
  });

  it('dry run validates and prints sizes, and writes nothing', async () => {
    await writeFile(source, draftWith({}));
    await exportPersona(options({ dryRun: true }), io);
    expect(existsSync(join(out, 'memory'))).toBe(false);
    expect(stdout).toContain('identity.md 79 bytes (limit 8192)');
    expect(stdout).toContain('goals.md 40 bytes (limit 4096)');
    expect(stdout).toContain('lint: clean');
  });

  it('refuses a persona the lint marks, prints only the offending line, and writes nothing', async () => {
    await writeFile(source, draftWith({ identity: 'You are an AI living in Angel Grove.' }));
    await expect(exportPersona(options(), io)).rejects.toThrow(/nothing was written.*--allow-meta/);
    expect(stderr).toEqual([
      'identity.md:1 [software] matched "AI": You are an AI living in Angel Grove.',
    ]);
    expect(stderr.join('\n')).not.toContain('Keep the spirits');
    expect(existsSync(join(out, 'memory'))).toBe(false);
  });

  it('keeps a marked persona with --allow-meta, and warns', async () => {
    await writeFile(source, draftWith({ goals: 'Find the harness that feeds you.' }));
    await exportPersona(options({ allowMeta: true }), io);
    expect(stderr).toContain(
      'goals.md:1 [meta] matched "harness": Find the harness that feeds you.',
    );
    expect(stderr).toContain(
      'warning: kept a persona that names the harness, shard, colo or credits',
    );
    expect(await readFile(join(out, 'memory', 'goals.md'), 'utf8')).toContain('harness');
  });

  // The identity file is the Identity, then "\n\n## Quirk\n\n" (12 bytes), the Quirk and a newline:
  // with the one-byte Quirk 'q' that is the Identity's length plus 14.
  it('refuses an identity file over 8192 bytes and goals over 4096, counting bytes not characters', async () => {
    await writeFile(source, draftWith({ identity: 'a'.repeat(8179), quirk: 'q' }));
    await expect(exportPersona(options({ dryRun: true }), io)).rejects.toThrow(
      /identity.md is 8193 bytes; the limit is 8192/,
    );
    await writeFile(source, draftWith({ identity: 'é'.repeat(4090), quirk: 'q' }));
    await expect(exportPersona(options({ dryRun: true }), io)).rejects.toThrow(
      /identity.md is 8194 bytes/,
    );
    await writeFile(source, draftWith({ goals: 'g'.repeat(4096) }));
    await expect(exportPersona(options({ dryRun: true }), io)).rejects.toThrow(
      /goals.md is 4097 bytes; the limit is 4096/,
    );
  });

  it('accepts files exactly at the caps', async () => {
    await writeFile(
      source,
      draftWith({ identity: 'a'.repeat(8178), quirk: 'q', goals: 'g'.repeat(4095) }),
    );
    await expect(exportPersona(options({ dryRun: true }), io)).resolves.toBeUndefined();
    expect(stdout).toContain('identity.md 8192 bytes (limit 8192)');
    expect(stdout).toContain('goals.md 4096 bytes (limit 4096)');
  });

  it('refuses control characters, naming the line and code point, and allows tab and newline', async () => {
    await writeFile(source, draftWith({ identity: 'Brave\u0007 and kind.' }));
    await expect(exportPersona(options({ dryRun: true }), io)).rejects.toThrow(
      /identity.md has a control character \(line 1, U\+0007\)/,
    );
    await writeFile(source, draftWith({ goals: 'Keep\u001b going.' }));
    await expect(exportPersona(options({ dryRun: true }), io)).rejects.toThrow(
      /goals.md has a control character \(line 1, U\+001B\)/,
    );
    await writeFile(source, draftWith({ identity: 'Brave\tand kind.' }));
    await expect(exportPersona(options({ dryRun: true }), io)).resolves.toBeUndefined();
  });

  it('never overwrites an existing memory file', async () => {
    await writeFile(source, draftWith({}));
    await mkdir(join(out, 'memory'), { recursive: true });
    await writeFile(join(out, 'memory', 'goals.md'), 'the player edited this\n');
    await expect(exportPersona(options(), io)).rejects.toThrow(/goals.md already exists/);
    expect(existsSync(join(out, 'memory', 'identity.md'))).toBe(false);
    expect(await readFile(join(out, 'memory', 'goals.md'), 'utf8')).toBe(
      'the player edited this\n',
    );
  });
});
