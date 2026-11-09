/** Line caps from the repo rules: a soft cap warns, a hard cap fails CI. */
export const SOFT_CAP = 500;
export const HARD_CAP = 700;

/** Extensions of files the caps apply to. Markdown and data files are exempt. */
const CAPPED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.java',
  '.kt',
  '.kts',
  '.go',
  '.sql',
  '.ps1',
  '.sh',
  '.py',
  '.yml',
  '.yaml',
]);

/** Generated output is owned by its generator, so it is never capped. */
const EXEMPT_PATTERNS = [/(^|\/)generated\//, /(^|\/)pnpm-lock\.yaml$/];

export type CapLevel = 'ok' | 'soft' | 'hard';

export interface CapFinding {
  path: string;
  lines: number;
  level: Exclude<CapLevel, 'ok'>;
}

/** True when the caps apply to this repo-relative, forward-slash path. */
export function isCapped(path: string): boolean {
  if (EXEMPT_PATTERNS.some((pattern) => pattern.test(path))) return false;
  const dot = path.lastIndexOf('.');
  return CAPPED_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

/** Number of lines in a file's text; a trailing newline does not start a new line. */
export function countLines(text: string): number {
  if (text.length === 0) return 0;
  const newlines = text.match(/\n/g)?.length ?? 0;
  return text.endsWith('\n') ? newlines : newlines + 1;
}

export function capLevel(lines: number): CapLevel {
  if (lines > HARD_CAP) return 'hard';
  if (lines > SOFT_CAP) return 'soft';
  return 'ok';
}

/** Findings for every capped file over the soft cap, hard findings first. */
export function checkFileCaps(files: ReadonlyArray<{ path: string; text: string }>): CapFinding[] {
  const findings: CapFinding[] = [];
  for (const file of files) {
    if (!isCapped(file.path)) continue;
    const lines = countLines(file.text);
    const level = capLevel(lines);
    if (level !== 'ok') findings.push({ path: file.path, lines, level });
  }
  return findings.sort((a, b) => (a.level === b.level ? 0 : a.level === 'hard' ? -1 : 1));
}
