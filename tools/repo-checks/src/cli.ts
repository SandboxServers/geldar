/**
 * Repo hygiene gate: fails on files over the hard line cap, on CRLF in the
 * index, on a stray control character or CR in a committed text file or in the
 * working tree (an unstaged edit or an untracked file; CRLF pairs there are
 * left to git's conversion, a lone CR is not), on a
 * compose port that does not bind to loopback, on a workflow that is not valid
 * YAML or repeats a key, on a sovereign MCP bearer token in any text file, or on a decision record that
 * `docs/decisions/README.md` does not index. Line caps cover
 * untracked, not-ignored files too, so a new file fails locally before it is
 * staged. Untracked CRLF needs no check: `.gitattributes`
 * (`text=auto eol=lf`) converts it to LF when the file is added.
 */
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  findControlChar,
  type IndexEntry,
  parseCatFileBatch,
  parseIndexEntries,
} from './control-chars.ts';
import { checkDecisionIndex } from './decision-index.ts';
import { checkFileCaps, HARD_CAP, SOFT_CAP } from './file-caps.ts';
import { checkSovereignIdentity, isShardFile } from './identity-mode.ts';
import { findCrlfInIndex } from './line-endings.ts';
import { findPublicPorts, isComposeFile } from './loopback-ports.ts';
import { findMcpTokens } from './mcp-token.ts';
import { checkPins } from './pin-rules.ts';
import {
  checkReleaseAge,
  extractPins,
  parseFirstPartyPrefixes,
  parseReleaseDates,
} from './release-age.ts';
import { checkWorkflowYaml, isWorkflowFile } from './workflow-yaml.ts';

const RELEASE_DATES = 'tools/repo-checks/src/release-dates.json';
const FIRST_PARTY_IMAGES = 'tools/repo-checks/src/first-party-images.json';

/** The file's text, or undefined when it cannot be read (the caller fails closed on that). */
function readOptional(path: string): string | undefined {
  try {
    return readFileSync(join(root, path), 'utf8');
  } catch {
    return undefined;
  }
}

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

function readFiles(paths: string[]): { path: string; text: string }[] {
  return paths.flatMap((path) => {
    try {
      return [{ path, text: readFileSync(join(root, path), 'utf8') }];
    } catch {
      return []; // deleted in the working tree but still in the index
    }
  });
}

/** Committed (index) content of every tracked file, so a local `core.autocrlf` cannot matter. */
function indexContents(entries: IndexEntry[]): Map<string, Buffer> {
  const request = entries.map((entry) => `:${entry.path}\n`).join('');
  const output = execFileSync('git', ['-C', root, 'cat-file', '--batch'], {
    input: request,
    maxBuffer: 1024 * 1024 * 1024,
  });
  return parseCatFileBatch(entries, output);
}

const entries = parseIndexEntries(git(['ls-files', '-s', '-z']));
const tracked = readFiles(entries.map((entry) => entry.path));
const untracked = readFiles(listFiles(['--others', '--exclude-standard']));
let failed = false;

for (const finding of checkFileCaps([...tracked, ...untracked])) {
  const cap = finding.level === 'hard' ? HARD_CAP : SOFT_CAP;
  const tag = finding.level === 'hard' ? 'error' : 'warning';
  console.log(`${tag}: ${finding.path} has ${finding.lines} lines (cap ${cap})`);
  if (finding.level === 'hard') failed = true;
}

const crlfPaths = new Set(findCrlfInIndex(git(['ls-files', '--eol'])));
for (const path of crlfPaths) {
  console.log(`error: ${path} is committed with CRLF line endings; .gitattributes requires LF`);
  failed = true;
}

const indexFindings: string[] = [];
try {
  for (const [path, content] of indexContents(entries)) {
    const found = findControlChar(path, content);
    // A CRLF file is already reported above: one message per file.
    if (found) indexFindings.push(`${path}:${found.line}:${found.byte}`);
    if (found && !(found.byte === 0x0d && crlfPaths.has(path))) {
      const byte = found.byte.toString(16).padStart(2, '0');
      console.log(
        `error: ${path}:${found.line} has a control character (0x${byte}); use LF and no raw control bytes`,
      );
      failed = true;
    }
  }
} catch (error) {
  // A git failure must fail the gate with one line, not a stack trace.
  console.log(`error: control-character check: ${(error as Error).message}`);
  failed = true;
}

/**
 * The working tree too: tracked files (an unstaged edit) and untracked,
 * not-ignored files (a new file not yet added). A defect already reported from
 * the index is not repeated.
 */
try {
  const reported = new Set(indexFindings);
  const treePaths = [
    ...entries.filter((entry) => !entry.gitlink).map((entry) => entry.path),
    ...listFiles(['--others', '--exclude-standard']),
  ];
  for (const path of new Set(treePaths)) {
    let bytes: Buffer;
    try {
      if (!lstatSync(join(root, path)).isFile()) continue;
      bytes = readFileSync(join(root, path));
    } catch {
      continue; // deleted in the working tree but still in the index
    }
    const found = findControlChar(path, bytes, true);
    if (!found) continue;
    const key = `${path}:${found.line}:${found.byte}`;
    if (reported.has(key)) continue;
    const byte = found.byte.toString(16).padStart(2, '0');
    console.log(
      `error: ${path}:${found.line} has a control character (0x${byte}) in the working tree; use LF and no raw control bytes`,
    );
    failed = true;
  }
} catch (error) {
  console.log(`error: working-tree control-character check: ${(error as Error).message}`);
  failed = true;
}

for (const file of [...tracked, ...untracked].filter((f) => isComposeFile(f.path))) {
  for (const port of findPublicPorts(file.path, file.text)) {
    console.log(
      `error: ${port.path} service ${port.service}: ${port.reason} (docs/threat-model.md section 1)`,
    );
    failed = true;
  }
}

for (const file of [...tracked, ...untracked]) {
  for (const location of findMcpTokens(file.path, file.text)) {
    console.log(
      `error: ${location}: an MCP bearer token is committed; revoke it and remove it (docs/threat-model.md section 3)`,
    );
    failed = true;
  }
}

for (const file of [...tracked, ...untracked].filter((f) => isWorkflowFile(f.path))) {
  for (const problem of checkWorkflowYaml(file.path, file.text)) {
    console.log(`error: ${problem}`);
    failed = true;
  }
}

for (const file of [...tracked, ...untracked]) {
  for (const problem of checkPins(file.path, file.text)) {
    console.log(`error: ${problem}`);
    failed = true;
  }
}

const releaseDates = parseReleaseDates(readOptional(RELEASE_DATES), RELEASE_DATES);
const firstParty = parseFirstPartyPrefixes(readOptional(FIRST_PARTY_IMAGES), FIRST_PARTY_IMAGES);
const pins = [...tracked, ...untracked].flatMap((file) => extractPins(file.path, file.text));
const ageProblems = [
  ...releaseDates.problems,
  ...firstParty.problems,
  ...checkReleaseAge(pins, releaseDates.dates, new Date(), firstParty.prefixes),
];
for (const problem of ageProblems) {
  console.log(`error: ${problem} (docs/threat-model.md, decision 0005: 14-day release floor)`);
  failed = true;
}

for (const file of [...tracked, ...untracked].filter((f) => isShardFile(f.path))) {
  for (const problem of checkSovereignIdentity(file.path, file.text)) {
    console.log(`error: ${problem}`);
    failed = true;
  }
}

for (const problem of checkDecisionIndex([...tracked, ...untracked])) {
  console.log(`error: ${problem}`);
  failed = true;
}

console.log(failed ? 'repo checks: failed' : 'repo checks: ok');
process.exitCode = failed ? 1 : 0;
