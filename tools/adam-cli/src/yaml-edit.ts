/**
 * Targeted edits of `shards/phase0.yaml` as text, so every comment and the layout survive (a
 * parse and re-serialise would drop the comments). Each edit touches one value on one line.
 */
import { PLACEHOLDER_DIGEST, type Tier } from './pins.ts';

/** The comment that follows a placeholder digest; it is replaced when the digest is recorded. */
const PLACEHOLDER_COMMENT = /#\s*placeholder: record at dispatch\s*$/;

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * The index range [start, end) of the lines inside the block that opens at line `header`: the
 * lines after it that are blank, comment-only or indented deeper than the header.
 */
function blockEnd(lines: string[], header: number): number {
  const base = indentOf(lines[header] ?? '');
  let end = header + 1;
  while (end < lines.length) {
    const line = lines[end] ?? '';
    const trimmed = line.trim();
    if (trimmed !== '' && !trimmed.startsWith('#') && indentOf(line) <= base) break;
    end++;
  }
  return end;
}

function findHeader(lines: string[], from: number, to: number, key: string): number {
  const pattern = new RegExp(`^\\s*"?${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"?:\\s*(#.*)?$`);
  for (let i = from; i < to; i++) if (pattern.test(lines[i] ?? '')) return i;
  return -1;
}

/** Replaces the value of `key:` on a line inside [from, to); throws when the line is absent. */
function replaceValue(
  lines: string[],
  from: number,
  to: number,
  key: string,
  value: string,
  quote: boolean,
  where: string,
): void {
  const pattern = new RegExp(`^(\\s*${key}:\\s*)("[^"]*"|[^\\s#]+)(.*)$`);
  for (let i = from; i < to; i++) {
    const match = pattern.exec(lines[i] ?? '');
    if (match === null) continue;
    lines[i] = `${match[1]}${quote ? `"${value}"` : value}${match[3]}`;
    return;
  }
  throw new Error(`${where}: no '${key}:' line found in shards/phase0.yaml`);
}

function splitLines(textIn: string): { lines: string[]; eol: string } {
  const eol = textIn.includes('\r\n') ? '\r\n' : '\n';
  return { lines: textIn.split(/\r?\n/), eol };
}

/** What {@link recordDigests} did. */
export interface RecordResult {
  text: string;
  /** Tags whose placeholder digest was replaced. */
  recorded: string[];
  /** Tags whose pinned digest was already a real one: left alone, even when it differs. */
  kept: string[];
}

/**
 * Writes the found digests over the placeholder digests of `model_pins` (the tags in `models`)
 * and `embedding` (the tag in `embedding`). A pin that already holds a real digest is never
 * overwritten: changing a recorded pin is a decision for the owner.
 */
export function recordDigests(
  source: string,
  models: string[],
  embeddingTag: string,
  found: Map<string, string>,
  today: string,
): RecordResult {
  const { lines, eol } = splitLines(source);
  const recorded: string[] = [];
  const kept: string[] = [];
  const pinsHeader = findHeader(lines, 0, lines.length, 'model_pins');
  if (pinsHeader < 0) throw new Error("no 'model_pins:' block in shards/phase0.yaml");
  const embeddingHeader = findHeader(lines, 0, lines.length, 'embedding');
  if (embeddingHeader < 0) throw new Error("no 'embedding:' block in shards/phase0.yaml");
  const targets: { tag: string; from: number; to: number }[] = [];
  const pinsEnd = blockEnd(lines, pinsHeader);
  for (const tag of models) {
    const header = findHeader(lines, pinsHeader + 1, pinsEnd, tag);
    if (header < 0) throw new Error(`model_pins has no entry for '${tag}'`);
    targets.push({ tag, from: header + 1, to: blockEnd(lines, header) });
  }
  targets.push({
    tag: embeddingTag,
    from: embeddingHeader + 1,
    to: blockEnd(lines, embeddingHeader),
  });
  for (const { tag, from, to } of targets) {
    const digest = found.get(tag);
    if (digest === undefined) throw new Error(`no digest found for '${tag}'`);
    const at = lines.findIndex((l, i) => i >= from && i < to && /^\s*digest:/.test(l));
    if (at < 0) throw new Error(`no 'digest:' line for '${tag}'`);
    if (!(lines[at] ?? '').includes(PLACEHOLDER_DIGEST)) {
      kept.push(tag);
      continue;
    }
    replaceValue(lines, at, at + 1, 'digest', digest, true, tag);
    lines[at] = (lines[at] ?? '').replace(
      PLACEHOLDER_COMMENT,
      `# recorded from Ollama on ${today}`,
    );
    recorded.push(tag);
  }
  return { text: lines.join(eol), recorded, kept };
}

/**
 * Points the life at a tier: `mind.agent.username`, `mind.agent.tier` and `mind.run_tier`.
 * Returns the text unchanged when it already matches.
 */
export function selectLife(source: string, tier: Tier, lifeId: string): string {
  const { lines, eol } = splitLines(source);
  const mind = findHeader(lines, 0, lines.length, 'mind');
  if (mind < 0) throw new Error("no 'mind:' block in shards/phase0.yaml");
  const mindEnd = blockEnd(lines, mind);
  const agent = findHeader(lines, mind + 1, mindEnd, 'agent');
  if (agent < 0) throw new Error("no 'mind.agent:' block in shards/phase0.yaml");
  const agentEnd = blockEnd(lines, agent);
  replaceValue(lines, agent + 1, agentEnd, 'username', lifeId, false, 'mind.agent');
  replaceValue(lines, agent + 1, agentEnd, 'tier', tier, false, 'mind.agent');
  replaceValue(lines, mind + 1, mindEnd, 'run_tier', tier, false, 'mind');
  return lines.join(eol);
}
