import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type IndexEntry, parseCatFileBatch } from './control-chars.ts';
import { type RepoPort, runRepoChecks } from './run-checks.ts';

const cliPath = fileURLToPath(new URL('./cli.ts', import.meta.url));

/**
 * The data files the gate fails closed without (the release-age lists and the IPv4 allowlist);
 * each fixture repo gets the real copies.
 */
const releaseDataFiles = [
  'tools/repo-checks/src/release-dates.json',
  'tools/repo-checks/src/first-party-images.json',
  'tools/repo-checks/src/ip-literal-allowlist.json',
];

function releaseData(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const path of releaseDataFiles) {
    files[path] = readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), 'utf8');
  }
  // A fixture repo holds no integration tests, so its floor is zero.
  files['tools/repo-checks/src/integration-floor.json'] = '{ "floor": 0 }\n';
  return files;
}

const realCompose = fileURLToPath(new URL('../../../compose/phase0.yml', import.meta.url));

/** The real compose file, with LF endings as git stores it. */
function realComposeText(): string {
  return readFileSync(realCompose, 'utf8').replace(/\r\n/g, '\n');
}

interface FakeRepo {
  /** Index (committed-to-be) content, path to text. */
  index: Record<string, string>;
  /** Working-tree text that differs from the index (tracked edits). */
  work?: Record<string, string>;
  /** Untracked, not-ignored files. */
  untracked?: Record<string, string>;
  /** Make git fail reading every index blob (a missing object). */
  unreadableIndex?: boolean;
}

/** An in-memory repository behind the gate's port; no git, no child process. */
function fakePort(repo: FakeRepo): RepoPort {
  const work = repo.work ?? {};
  const untracked = repo.untracked ?? {};
  const text = (path: string): string | undefined =>
    work[path] ?? untracked[path] ?? repo.index[path];
  return {
    indexEntries: () => Object.keys(repo.index).map((path) => ({ path, gitlink: false })),
    untrackedPaths: () => Object.keys(untracked),
    crlfPaths: () =>
      Object.entries(repo.index)
        .filter(([, t]) => t.includes('\r\n'))
        .map(([p]) => p),
    indexBlobs: (entries: IndexEntry[]) => {
      if (repo.unreadableIndex) {
        // The reply git gives for an object it cannot find.
        return parseCatFileBatch(entries, Buffer.from(`:${entries[0]?.path} missing\n`));
      }
      return new Map(entries.map((e) => [e.path, Buffer.from(repo.index[e.path] ?? '')]));
    },
    readText: text,
    readFileBytes: (path) => {
      const t = text(path);
      return t === undefined ? undefined : Buffer.from(t);
    },
  };
}

/** The real clock, as the CLI uses: the real compose pins must be past the 14-day floor today. */
const NOW = new Date();

/** The gate over a fake repo whose only compose file is `compose/phase0.yml` with this text. */
function runGate(
  compose: string,
  extra: Record<string, string> = {},
  more: Omit<FakeRepo, 'index'> = {},
): { status: number; output: string } {
  const result = runRepoChecks(
    fakePort({ index: { 'compose/phase0.yml': compose, ...extra, ...releaseData() }, ...more }),
    NOW,
  );
  return { status: result.failed ? 1 : 0, output: result.lines.join('\n') };
}

/** A repo with `note.md` clean in the index, after `setup` changed it. */
function runTree(
  more: Omit<FakeRepo, 'index'>,
  index: Record<string, string> = {},
): { status: number; output: string } {
  const result = runRepoChecks(
    fakePort({ index: { 'note.md': 'one\ntwo\n', ...index, ...releaseData() }, ...more }),
    NOW,
  );
  return { status: result.failed ? 1 : 0, output: result.lines.join('\n') };
}

describe('repo-checks gate, compose port wiring', () => {
  it('passes the real compose/phase0.yml', () => {
    const result = runGate(realComposeText());
    expect(result.output).toContain('repo checks: ok');
    expect(result.status).toBe(0);
  });

  it('fails a bare port in the real compose/phase0.yml', () => {
    const text = realComposeText();
    const mutated = text.replace('"127.0.0.1:5432:5432"', '"5432:5432"');
    expect(mutated).not.toBe(text);
    const result = runGate(mutated);
    expect(result.status).toBe(1);
    expect(result.output).toContain('service postgres');
  });

  it('fails network_mode: host in the real compose/phase0.yml', () => {
    const text = realComposeText();
    const mutated = text.replace('  nats:\n', '  nats:\n    network_mode: host\n');
    expect(mutated).not.toBe(text);
    const result = runGate(mutated);
    expect(result.status).toBe(1);
    expect(result.output).toContain('service nats');
  });
});

describe('repo-checks gate, decision index wiring', () => {
  it('fails a decision record that docs/decisions/README.md does not list', () => {
    const result = runGate(realComposeText(), {
      'docs/decisions/0001-contract.md': '# 0001. Contract\n',
      'docs/decisions/README.md': '# Decisions\n',
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain('does not list 0001-contract.md');
  });
});

describe('repo-checks gate, control character wiring', () => {
  it('fails a control character committed in a tracked text file', () => {
    const result = runGate(realComposeText(), { 'docs/note.md': 'one\ntwo\u001b\n' });
    expect(result.status).toBe(1);
    expect(result.output).toContain('docs/note.md:2 has a control character (0x1b)');
  });

  it('fails a lone CR committed in a tracked text file', () => {
    const result = runGate(realComposeText(), { 'docs/note.md': 'one\rtwo\n' });
    expect(result.status).toBe(1);
    expect(result.output).toContain('docs/note.md:1 has a control character (0x0d)');
  });

  it('reports a CRLF file once, as CRLF', () => {
    const result = runGate(realComposeText(), { 'docs/note.md': 'one\r\ntwo\r\n' });
    expect(result.status).toBe(1);
    expect(result.output).toContain('docs/note.md is committed with CRLF');
    expect(result.output).not.toContain('docs/note.md:1 has a control character');
  });

  it('prints one error line and fails when git cannot read an index blob', () => {
    const result = runTree({ unreadableIndex: true });
    expect(result.status).toBe(1);
    expect(result.output).toContain(
      'error: control-character check: git cannot read the index copy',
    );
    expect(result.output).toContain('repo checks: failed');
  });

  describe('working tree', () => {
    it('passes a clean tree', () => {
      const result = runTree({});
      expect(result.output).toContain('repo checks: ok');
      expect(result.status).toBe(0);
    });

    it('fails a staged defect once, as an index finding', () => {
      const result = runTree({}, { 'note.md': 'one\ntwo\u0007\n' });
      expect(result.status).toBe(1);
      expect(result.output).toContain('note.md:2 has a control character (0x07);');
      expect(result.output).not.toContain('in the working tree');
    });

    it('fails an unstaged defect in a tracked file', () => {
      const result = runTree({ work: { 'note.md': 'one\rtwo\n' } });
      expect(result.status).toBe(1);
      expect(result.output).toContain(
        'note.md:1 has a control character (0x0d) in the working tree',
      );
    });

    it('fails a defect in an untracked file', () => {
      const result = runTree({ untracked: { 'new.md': 'a\nb\u000c\n' } });
      expect(result.status).toBe(1);
      expect(result.output).toContain(
        'new.md:2 has a control character (0x0c) in the working tree',
      );
    });

    it('lets git convert CRLF pairs in the working tree', () => {
      const result = runTree({ untracked: { 'new.md': 'a\r\nb\r\n' } });
      expect(result.output).toContain('repo checks: ok');
    });
  });
});

describe('repo-checks CLI, real git (the one spawn case)', () => {
  it('judges the index under autocrlf, exits 0 then 1, and checks the whole repo from a subdirectory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'repo-checks-eol-'));
    const run = (cwd: string): { status: number; output: string } => {
      try {
        return {
          status: 0,
          output: execFileSync(process.execPath, [cliPath], { cwd, encoding: 'utf8' }),
        };
      } catch (error) {
        const failed = error as { status: number; stdout: string };
        return { status: failed.status, output: failed.stdout };
      }
    };
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir });
      execFileSync('git', ['config', 'core.autocrlf', 'true'], { cwd: dir });
      writeFileSync(join(dir, 'note.md'), 'one\r\ntwo\r\n');
      for (const [path, text] of Object.entries(releaseData())) {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), text);
      }
      // A defect in an ignored untracked file is ignored (git's --exclude-standard).
      writeFileSync(join(dir, '.gitignore'), 'scratch.md\n');
      writeFileSync(join(dir, 'scratch.md'), 'a\u0007\n');
      execFileSync('git', ['add', '-A'], { cwd: dir });
      const clean = run(dir);
      expect(clean.output).toContain('repo checks: ok');
      expect(clean.status).toBe(0);

      mkdirSync(join(dir, 'docs'));
      writeFileSync(join(dir, 'docs', 'note.md'), 'one\rtwo\n');
      execFileSync('git', ['-c', 'core.autocrlf=false', 'add', '-A'], { cwd: dir });
      const dirty = run(join(dir, 'docs'));
      expect(dirty.status).toBe(1);
      expect(dirty.output).toContain('docs/note.md:1 has a control character (0x0d)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
