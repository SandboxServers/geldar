import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** A template file split into its numbered blocks and named variant sections. */
export interface ParsedTemplate {
  /** `<kind>@<n>+sha256:<12 hex of the file>`. Recorded on every thought. */
  version: string;
  blocks: Map<number, string>;
  variants: Map<string, string>;
}

const MARKER = /^<<(block (\d+)|variant ([a-z_]+))>>$/;
const SLOT = /\{\{([a-z_]+)\}\}/g;

/** The version id of a file: the kind, the number from the file name, 12 hex characters of its SHA-256. */
export function versionId(kind: string, number: number, bytes: Buffer): string {
  return `${kind}@${number}+sha256:${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}`;
}

/** Reads and splits a template file. Throws on text before the first marker or a repeated marker. */
export function loadTemplate(kind: string, number: number, path: string): ParsedTemplate {
  const bytes = readFileSync(path);
  const text = bytes.toString('utf8').replace(/\r\n/g, '\n');
  const blocks = new Map<number, string>();
  const variants = new Map<string, string>();
  let current: { key: string; lines: string[] } | null = null;
  const close = (): void => {
    if (current === null) return;
    const body = current.lines.join('\n').replace(/\n+$/, '');
    const [type, name] = current.key.split(' ') as [string, string];
    if (type === 'block') blocks.set(Number(name), body);
    else variants.set(name, body);
  };
  const seen = new Set<string>();
  for (const line of text.split('\n')) {
    const marker = MARKER.exec(line);
    if (marker !== null) {
      close();
      const key = marker[1] as string;
      if (seen.has(key)) throw new Error(`${path}: the marker <<${key}>> appears twice`);
      seen.add(key);
      current = { key, lines: [] };
    } else if (current === null) {
      if (line.trim() !== '') throw new Error(`${path}: text before the first marker`);
    } else {
      current.lines.push(line);
    }
  }
  close();
  return { version: versionId(kind, number, bytes), blocks, variants };
}

/** The slot names a piece of template text uses. */
export function slotsOf(text: string): string[] {
  return Array.from(text.matchAll(SLOT), (m) => m[1] as string);
}

/**
 * Fills `{{name}}` slots in one pass: a value is never scanned again, so a value cannot open a
 * slot. Throws on a slot with no value (unfilled) and on a slot the renderer does not know.
 */
export function fill(
  text: string,
  values: Readonly<Record<string, string>>,
  where: string,
): string {
  return text.replace(SLOT, (_all, name: string) => {
    const value = Object.hasOwn(values, name) ? values[name] : undefined;
    if (value === undefined) throw new Error(`${where}: slot {{${name}}} has no value`);
    return value;
  });
}

/** Throws when `text` uses a slot outside `known`. */
export function refuseUnknownSlots(text: string, known: ReadonlySet<string>, where: string): void {
  for (const name of slotsOf(text)) {
    if (!known.has(name)) throw new Error(`${where}: unknown slot {{${name}}}`);
  }
}
