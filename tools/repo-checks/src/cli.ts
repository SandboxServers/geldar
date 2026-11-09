/** Repo hygiene gate: fails on files over the hard line cap or CRLF in the index. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { checkFileCaps, HARD_CAP, SOFT_CAP } from './file-caps.ts';
import { findCrlfInIndex } from './line-endings.ts';

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

const tracked = git(['ls-files', '-z'])
  .split('\0')
  .filter((path) => path !== '');

const files = tracked.flatMap((path) => {
  try {
    return [{ path, text: readFileSync(path, 'utf8') }];
  } catch {
    return []; // deleted in the working tree but still in the index
  }
});

let failed = false;

for (const finding of checkFileCaps(files)) {
  const cap = finding.level === 'hard' ? HARD_CAP : SOFT_CAP;
  const tag = finding.level === 'hard' ? 'error' : 'warning';
  console.log(`${tag}: ${finding.path} has ${finding.lines} lines (cap ${cap})`);
  if (finding.level === 'hard') failed = true;
}

for (const path of findCrlfInIndex(git(['ls-files', '--eol']))) {
  console.log(`error: ${path} is committed with CRLF line endings; .gitattributes requires LF`);
  failed = true;
}

console.log(failed ? 'repo checks: failed' : 'repo checks: ok');
process.exitCode = failed ? 1 : 0;
