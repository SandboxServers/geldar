/**
 * Repo hygiene gate: fails on files over the hard line cap, on CRLF in the
 * index, on a stray control character or CR in a committed text file or in the
 * working tree (an unstaged edit or an untracked file; CRLF pairs there are
 * left to git's conversion, a lone CR is not), on a
 * compose port that does not bind to loopback, on a workflow that is not valid
 * YAML or repeats a key, on a sovereign MCP bearer token in any text file, on an IPv4 literal the
 * policy in decision 0132 does not allow, or on a decision record that `docs/decisions/README.md`
 * does not index. Line caps cover
 * untracked, not-ignored files too, so a new file fails locally before it is
 * staged. Untracked CRLF needs no check: `.gitattributes`
 * (`text=auto eol=lf`) converts it to LF when the file is added.
 *
 * The checks themselves live in `run-checks.ts`; this file is the git-backed port.
 */
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCatFileBatch, parseIndexEntries } from './control-chars.ts';
import { findCrlfInIndex } from './line-endings.ts';
import { type RepoPort, runRepoChecks } from './run-checks.ts';

/** Every path below is relative to the repo root, wherever the CLI runs from. */
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

function git(args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function listFiles(args: string[]): string[] {
  return git(['ls-files', '-z', ...args])
    .split('\0')
    .filter((path) => path !== '');
}

/** Committed (index) content of every tracked file, so a local `core.autocrlf` cannot matter. */
const port: RepoPort = {
  indexEntries: () => parseIndexEntries(git(['ls-files', '-s', '-z'])),
  untrackedPaths: () => listFiles(['--others', '--exclude-standard']),
  crlfPaths: () => findCrlfInIndex(git(['ls-files', '--eol'])),
  indexBlobs: (entries) => {
    const request = entries.map((entry) => `:${entry.path}\n`).join('');
    const output = execFileSync('git', ['-C', root, 'cat-file', '--batch'], {
      input: request,
      maxBuffer: 1024 * 1024 * 1024,
    });
    return parseCatFileBatch(entries, output);
  },
  readText: (path) => {
    try {
      return readFileSync(join(root, path), 'utf8');
    } catch {
      return undefined;
    }
  },
  readFileBytes: (path) => {
    try {
      if (!lstatSync(join(root, path)).isFile()) return undefined;
      return readFileSync(join(root, path));
    } catch {
      return undefined;
    }
  },
};

const result = runRepoChecks(port, new Date());
for (const line of result.lines) console.log(line);
process.exitCode = result.failed ? 1 : 0;
