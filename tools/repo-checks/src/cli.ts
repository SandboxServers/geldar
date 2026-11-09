/**
 * Repo hygiene gate: fails on files over the hard line cap, on CRLF in the
 * index, or on a compose port that does not bind to loopback. Line caps cover untracked, not-ignored files too, so a new file fails
 * locally before it is staged. Untracked CRLF needs no check: `.gitattributes`
 * (`text=auto eol=lf`) converts it to LF when the file is added.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { checkFileCaps, HARD_CAP, SOFT_CAP } from './file-caps.ts';
import { findCrlfInIndex } from './line-endings.ts';
import { findPublicPorts, isComposeFile } from './loopback-ports.ts';

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function listFiles(args: string[]): string[] {
  return git(['ls-files', '-z', ...args])
    .split('\0')
    .filter((path) => path !== '');
}

function readFiles(paths: string[]): { path: string; text: string }[] {
  return paths.flatMap((path) => {
    try {
      return [{ path, text: readFileSync(path, 'utf8') }];
    } catch {
      return []; // deleted in the working tree but still in the index
    }
  });
}

const tracked = readFiles(listFiles(['--cached']));
const untracked = readFiles(listFiles(['--others', '--exclude-standard']));

let failed = false;

for (const finding of checkFileCaps([...tracked, ...untracked])) {
  const cap = finding.level === 'hard' ? HARD_CAP : SOFT_CAP;
  const tag = finding.level === 'hard' ? 'error' : 'warning';
  console.log(`${tag}: ${finding.path} has ${finding.lines} lines (cap ${cap})`);
  if (finding.level === 'hard') failed = true;
}

for (const path of findCrlfInIndex(git(['ls-files', '--eol']))) {
  console.log(`error: ${path} is committed with CRLF line endings; .gitattributes requires LF`);
  failed = true;
}

for (const file of [...tracked, ...untracked].filter((f) => isComposeFile(f.path))) {
  for (const port of findPublicPorts(file.path, file.text)) {
    console.log(
      `error: ${port.path}:${port.line} publishes ${port.entry}; compose ports must start with 127.0.0.1: (docs/threat-model.md section 1)`,
    );
    failed = true;
  }
}

console.log(failed ? 'repo checks: failed' : 'repo checks: ok');
process.exitCode = failed ? 1 : 0;
