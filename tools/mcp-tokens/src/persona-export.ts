/**
 * `persona export`: writes an approved ranger persona to <dir>/memory/identity.md and
 * <dir>/memory/goals.md for the owner's launcher. The directory must lie outside every git work
 * tree and outside this repo, so no persona text lands in git. The same persona lint as `player add`
 * runs on both files: a hit refuses the export and prints only the offending lines, unless
 * --allow-meta keeps the persona with a warning. Existing files are never overwritten.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { findPersona, type PersonaFiles, personaFiles } from './persona-draft.ts';
import { markText, type PersonaHit, personaHits } from './persona-lint.ts';
import { GOALS_MAX_BYTES, IDENTITY_MAX_BYTES } from './players.ts';
import { type AclOptions, REPO_ROOT, restrictToOwner, writeOwnerOnly } from './secret-files.ts';
import { checkOutPath } from './tokens.ts';

/** The approved drafts, in the repo's docs. The export only reads this file. */
export const DRAFT_PATH = join(
  REPO_ROOT,
  'docs',
  'analysis',
  'phase0',
  'worknotes',
  'ranger-personas-draft.md',
);

/** The two files the launcher reads, under <dir>/memory. */
const IDENTITY_FILE = 'identity.md';
const GOALS_FILE = 'goals.md';

/** Where the command writes its lines; tests pass their own. */
export interface ExportIo {
  out(line: string): void;
  err(line: string): void;
}

export interface ExportOptions {
  /** A character name (`jason`, `Red Ranger`) or a life id (`ag_jason_01`). */
  name: string;
  /** The directory that gets memory/; it must be outside every repo. */
  out: string;
  /** The draft to read; defaults to DRAFT_PATH. */
  source?: string;
  dryRun?: boolean;
  allowMeta?: boolean;
  acl?: AclOptions;
  /** Whether a directory lies in a git work tree; tests inject it, the default walks up for .git. */
  inWorkTree?: (dir: string) => boolean;
}

/** A real .git entry: a worktree's `gitdir:` file, or a repo's directory that holds a HEAD file. */
function isGitEntry(entry: string): boolean {
  try {
    const info = statSync(entry);
    if (info.isDirectory()) return existsSync(join(entry, 'HEAD'));
    return info.isFile() && readFileSync(entry, 'utf8').startsWith('gitdir:');
  } catch {
    return false;
  }
}

/** True when `dir` or one of its parents holds a real .git entry; empty .git directories are skipped. */
export function insideGitWorkTree(dir: string): boolean {
  let current = resolve(dir);
  while (!isGitEntry(join(current, '.git'))) {
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
  return true;
}

/** Refuses an --out inside this repo (through symlinks too) or inside any git work tree. */
export function checkExportDir(
  out: string,
  inWorkTree: (dir: string) => boolean = insideGitWorkTree,
  repoRoot?: string,
): void {
  checkOutPath(out, repoRoot);
  if (inWorkTree(out)) {
    throw new Error(
      `--out ${out} is inside a git work tree; choose a directory outside every repo`,
    );
  }
}

/** A control character other than tab and newline, as its line and code point; undefined when none. */
function controlAt(text: string): string | undefined {
  let line = 1;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (char === '\n') line += 1;
    const control =
      (code < 0x20 && code !== 0x09 && code !== 0x0a) || (code >= 0x7f && code <= 0x9f);
    if (control) return `line ${line}, U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
  }
  return undefined;
}

/** Checks one file's size in UTF-8 bytes and its control characters. The message never quotes the text. */
function checkFile(file: string, text: string, maxBytes: number): number {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > maxBytes) throw new Error(`${file} is ${bytes} bytes; the limit is ${maxBytes}`);
  const control = controlAt(text);
  if (control !== undefined) {
    throw new Error(
      `${file} has a control character (${control}); only newline and tab are allowed`,
    );
  }
  return bytes;
}

/** One lint hit in one file, with the line it is on. */
interface FileHit {
  file: string;
  line: string;
  hit: PersonaHit;
}

function lintFile(file: string, text: string): FileHit[] {
  const lines = text.split('\n');
  return personaHits(text).map((hit) => ({ file, line: lines[hit.line - 1] ?? '', hit }));
}

function formatHit({ file, line, hit }: FileHit): string {
  return `${file}:${hit.line} [${hit.mark}] matched "${hit.matched}": ${line}`;
}

/** The export: validates, lints, then writes both files, or only reports them in a dry run. */
export async function exportPersona(options: ExportOptions, io: ExportIo): Promise<void> {
  checkExportDir(options.out, options.inWorkTree);
  const draft = await readFile(options.source ?? DRAFT_PATH, 'utf8');
  const persona = findPersona(draft, options.name);
  const files: PersonaFiles = personaFiles(persona);
  const identityBytes = checkFile(IDENTITY_FILE, files.identity, IDENTITY_MAX_BYTES);
  const goalsBytes = checkFile(GOALS_FILE, files.goals, GOALS_MAX_BYTES);

  const hits = [...lintFile(IDENTITY_FILE, files.identity), ...lintFile(GOALS_FILE, files.goals)];
  if (hits.length > 0) {
    for (const hit of hits) io.err(formatHit(hit));
    const marks = [...new Set(hits.map((hit) => hit.hit.mark))];
    if (options.allowMeta !== true) {
      throw new Error(
        `the persona ${markText(marks)}; nothing was written. Remove those lines, or pass --allow-meta to keep the persona`,
      );
    }
    io.err(`warning: kept a persona that ${markText(marks)}`);
  }

  if (options.dryRun === true) {
    io.out(`dry run: persona ${persona.name}; nothing written`);
    io.out(`${IDENTITY_FILE} ${identityBytes} bytes (limit ${IDENTITY_MAX_BYTES})`);
    io.out(`${GOALS_FILE} ${goalsBytes} bytes (limit ${GOALS_MAX_BYTES})`);
    io.out(`lint: ${hits.length === 0 ? 'clean' : `${hits.length} hit(s), listed above`}`);
    return;
  }

  if (existsSync(resolve(options.out))) {
    throw new Error(
      `--out ${options.out} already exists; choose a directory that does not exist yet`,
    );
  }
  const memory = join(resolve(options.out), 'memory');
  const paths = { identity: join(memory, IDENTITY_FILE), goals: join(memory, GOALS_FILE) };
  for (const path of [paths.identity, paths.goals]) {
    if (existsSync(path))
      throw new Error(`${path} already exists; remove it or choose another --out`);
  }
  await mkdir(memory, { recursive: true });
  await restrictToOwner(memory, options.acl);
  await writeOwnerOnly(paths.identity, files.identity, 'wx', options.acl);
  await writeOwnerOnly(paths.goals, files.goals, 'wx', options.acl);
  io.out(`wrote ${paths.identity} (${identityBytes} bytes)`);
  io.out(`wrote ${paths.goals} (${goalsBytes} bytes)`);
}
