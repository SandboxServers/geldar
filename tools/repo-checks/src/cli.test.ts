import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cliPath = fileURLToPath(new URL('./cli.ts', import.meta.url));

/** The release-age data files the CLI fails closed without; each fixture repo gets the real copies. */
const releaseDataFiles = [
  'tools/repo-checks/src/release-dates.json',
  'tools/repo-checks/src/first-party-images.json',
];

function copyReleaseData(dir: string): void {
  for (const path of releaseDataFiles) {
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url))),
    );
  }
}
const realCompose = fileURLToPath(new URL('../../../compose/phase0.yml', import.meta.url));

/**
 * Each case runs git twice or more and then a Node child, all synchronously. On a loaded Windows host
 * that passes vitest's 5 s default now and then, so every case here gets this headroom.
 */
const CLI_TEST_MS = 30_000;

/** The real compose file, with LF endings as git stores it. */
function realComposeText(): string {
  return readFileSync(realCompose, 'utf8').replace(/\r\n/g, '\n');
}

/**
 * Runs the repo-checks CLI, the same way `pnpm check:repo` does, inside a fresh
 * git repo whose only compose file is `compose/phase0.yml` with this text, plus
 * any `extra` files (path to text).
 */
function runCli(
  compose: string,
  extra: Record<string, string> = {},
  runIn = '',
): { status: number; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'repo-checks-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    mkdirSync(join(dir, 'compose'));
    writeFileSync(join(dir, 'compose', 'phase0.yml'), compose);
    for (const [path, text] of Object.entries(extra)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    copyReleaseData(dir);
    execFileSync('git', ['-c', 'core.autocrlf=false', 'add', '-A'], { cwd: dir });
    try {
      const output = execFileSync(process.execPath, [cliPath], {
        cwd: join(dir, runIn),
        encoding: 'utf8',
      });
      return { status: 0, output };
    } catch (error) {
      const failed = error as { status: number; stdout: string };
      return { status: failed.status, output: failed.stdout };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('repo-checks CLI, compose port wiring', () => {
  it(
    'passes the real compose/phase0.yml',
    () => {
      const result = runCli(realComposeText());
      expect(result.output).toContain('repo checks: ok');
      expect(result.status).toBe(0);
    },
    CLI_TEST_MS,
  );

  it(
    'fails a bare port in the real compose/phase0.yml',
    () => {
      const text = realComposeText();
      const mutated = text.replace('"127.0.0.1:5432:5432"', '"5432:5432"');
      expect(mutated).not.toBe(text);
      const result = runCli(mutated);
      expect(result.status).toBe(1);
      expect(result.output).toContain('service postgres');
    },
    CLI_TEST_MS,
  );

  it(
    'fails network_mode: host in the real compose/phase0.yml',
    () => {
      const text = realComposeText();
      const mutated = text.replace('  nats:\n', '  nats:\n    network_mode: host\n');
      expect(mutated).not.toBe(text);
      const result = runCli(mutated);
      expect(result.status).toBe(1);
      expect(result.output).toContain('service nats');
    },
    CLI_TEST_MS,
  );
});

describe('repo-checks CLI, decision index wiring', () => {
  it(
    'fails a decision record that docs/decisions/README.md does not list',
    () => {
      const result = runCli(realComposeText(), {
        'docs/decisions/0001-contract.md': '# 0001. Contract\n',
        'docs/decisions/README.md': '# Decisions\n',
      });
      expect(result.status).toBe(1);
      expect(result.output).toContain('does not list 0001-contract.md');
    },
    CLI_TEST_MS,
  );
});

describe('repo-checks CLI, control character wiring', () => {
  it(
    'fails a control character committed in a tracked text file',
    () => {
      const result = runCli(realComposeText(), { 'docs/note.md': 'one\ntwo\u001b\n' });
      expect(result.status).toBe(1);
      expect(result.output).toContain('docs/note.md:2 has a control character (0x1b)');
    },
    CLI_TEST_MS,
  );

  it(
    'fails a lone CR committed in a tracked text file',
    () => {
      const result = runCli(realComposeText(), { 'docs/note.md': 'one\rtwo\n' });
      expect(result.status).toBe(1);
      expect(result.output).toContain('docs/note.md:1 has a control character (0x0d)');
    },
    CLI_TEST_MS,
  );

  it(
    'checks the whole repo when run from a subdirectory',
    () => {
      const result = runCli(realComposeText(), { 'docs/note.md': 'one\rtwo\n' }, 'compose');
      expect(result.status).toBe(1);
      expect(result.output).toContain('docs/note.md:1 has a control character (0x0d)');
    },
    CLI_TEST_MS,
  );

  it(
    'reports a CRLF file once, as CRLF',
    () => {
      const result = runCli(realComposeText(), { 'docs/note.md': 'one\r\ntwo\r\n' });
      expect(result.status).toBe(1);
      expect(result.output).toContain('docs/note.md is committed with CRLF');
      expect(result.output).not.toContain('docs/note.md:1 has a control character');
    },
    CLI_TEST_MS,
  );

  it(
    'prints one error line and exits 1 when git cannot read an index blob',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'repo-checks-gitfail-'));
      try {
        execFileSync('git', ['init', '-q'], { cwd: dir });
        execFileSync(
          'git',
          ['update-index', '--add', '--cacheinfo', `100644,${'1'.repeat(40)},note.md`],
          { cwd: dir },
        );
        let status = 0;
        let output = '';
        try {
          output = execFileSync(process.execPath, [cliPath], { cwd: dir, encoding: 'utf8' });
        } catch (error) {
          const failed = error as { status: number; stdout: string };
          status = failed.status;
          output = failed.stdout;
        }
        expect(status).toBe(1);
        expect(output).toContain('error: control-character check: git cannot read the index copy');
        expect(output).toContain('repo checks: failed');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    CLI_TEST_MS,
  );

  describe('working tree', () => {
    /** Runs the CLI in a repo with `note.md` committed clean, after `setup` changed it. */
    function runTree(setup: (dir: string) => void): { status: number; output: string } {
      const dir = mkdtempSync(join(tmpdir(), 'repo-checks-tree-'));
      try {
        execFileSync('git', ['init', '-q'], { cwd: dir });
        writeFileSync(join(dir, 'note.md'), 'one\ntwo\n');
        copyReleaseData(dir);
        execFileSync('git', ['add', '-A'], { cwd: dir });
        execFileSync(
          'git',
          ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'],
          { cwd: dir },
        );
        setup(dir);
        try {
          return {
            status: 0,
            output: execFileSync(process.execPath, [cliPath], { cwd: dir, encoding: 'utf8' }),
          };
        } catch (error) {
          const failed = error as { status: number; stdout: string };
          return { status: failed.status, output: failed.stdout };
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    it(
      'passes a clean tree',
      () => {
        const result = runTree(() => {});
        expect(result.output).toContain('repo checks: ok');
        expect(result.status).toBe(0);
      },
      CLI_TEST_MS,
    );

    it(
      'fails a staged defect once, as an index finding',
      () => {
        const result = runTree((dir) => {
          writeFileSync(join(dir, 'note.md'), 'one\ntwo\u0007\n');
          execFileSync('git', ['add', 'note.md'], { cwd: dir });
        });
        expect(result.status).toBe(1);
        expect(result.output).toContain('note.md:2 has a control character (0x07);');
        expect(result.output).not.toContain('in the working tree');
      },
      CLI_TEST_MS,
    );

    it(
      'fails an unstaged defect in a tracked file',
      () => {
        const result = runTree((dir) => writeFileSync(join(dir, 'note.md'), 'one\rtwo\n'));
        expect(result.status).toBe(1);
        expect(result.output).toContain(
          'note.md:1 has a control character (0x0d) in the working tree',
        );
      },
      CLI_TEST_MS,
    );

    it(
      'fails a defect in an untracked file',
      () => {
        const result = runTree((dir) => writeFileSync(join(dir, 'new.md'), 'a\nb\u000c\n'));
        expect(result.status).toBe(1);
        expect(result.output).toContain(
          'new.md:2 has a control character (0x0c) in the working tree',
        );
      },
      CLI_TEST_MS,
    );

    it(
      'ignores a defect in an ignored untracked file',
      () => {
        const result = runTree((dir) => {
          writeFileSync(join(dir, '.gitignore'), 'scratch.md\n');
          writeFileSync(join(dir, 'scratch.md'), 'a\u0007\n');
        });
        expect(result.output).toContain('repo checks: ok');
      },
      CLI_TEST_MS,
    );

    it(
      'lets git convert CRLF pairs in the working tree',
      () => {
        const result = runTree((dir) => writeFileSync(join(dir, 'new.md'), 'a\r\nb\r\n'));
        expect(result.output).toContain('repo checks: ok');
      },
      CLI_TEST_MS,
    );
  });

  it(
    'judges the index, not a working tree that autocrlf made CRLF',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'repo-checks-eol-'));
      try {
        execFileSync('git', ['init', '-q'], { cwd: dir });
        execFileSync('git', ['config', 'core.autocrlf', 'true'], { cwd: dir });
        writeFileSync(join(dir, 'note.md'), 'one\r\ntwo\r\n');
        copyReleaseData(dir);
        execFileSync('git', ['add', '-A'], { cwd: dir });
        const output = execFileSync(process.execPath, [cliPath], { cwd: dir, encoding: 'utf8' });
        expect(output).toContain('repo checks: ok');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    CLI_TEST_MS,
  );
});
