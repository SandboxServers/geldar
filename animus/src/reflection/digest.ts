/**
 * The reflection digest (spec 5.4): a deterministic, byte-stable summary of what happened since
 * the last reflection, built from the journal and the events, never from a model. The same input
 * always gives the same bytes. Speech and other in-world text enters only as JSON-escaped strings.
 */
import type { JournalEntry, MemoryRow, MindEvent } from '../ports/index.ts';

/** The most bytes a digest may take (spec 5.4: a digest, not the raw journal). */
export const DIGEST_MAX_BYTES = 6144;

/** An inventory jump of at least this many of one item is a windfall. */
export const WINDFALL_MIN = 8;

const LINE_MAX_CHARS = 200;
const SPEECH_MAX_LINES = 20;
const SECTION_MAX_LINES = 12;

/** The agent's inventory as seen at one tick (taken from a snapshot by the caller). */
export interface InventoryReading {
  tick: number;
  /** The snapshot's inventory stacks. */
  items: { item: string; count: number }[];
}

/** Everything the digest is built from. */
export interface DigestInput {
  /** The world day being summarised. */
  day: number;
  /** The tick the last reflection covered up to; the journal and events start here. */
  sinceTick: number;
  /** The tick of the sleep that triggers the reflection. */
  nowTick: number;
  events: MindEvent[];
  journal: JournalEntry[];
  inventory: InventoryReading[];
  /** Active semantic memories. */
  beliefs: MemoryRow[];
  /** Commitment memories, open or resolved. */
  commitments: MemoryRow[];
  /** The names the agent already has a relationship with. */
  knownNames: string[];
}

/** The digest text and the lines the apply step checks provenance against. */
export interface Digest {
  text: string;
  /** What the agent saw or did itself: the only lines that can back an `observation`. */
  ownObservations: string[];
  /** What others said: backs a `report` only. */
  heard: string[];
}

interface Section {
  title: string;
  lines: string[];
}

function clip(text: string, max = LINE_MAX_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** JSON-escaped, so in-world text cannot read as the digest's own structure. */
function quoted(text: string, max = 160): string {
  return JSON.stringify(clip(text, max));
}

/** Orders events by tick, then event id, so the order never depends on arrival. */
function ordered(events: MindEvent[]): MindEvent[] {
  return [...events]
    .filter((e) => e.tick >= 0)
    .sort(
      (a, b) => a.tick - b.tick || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0),
    );
}

/** Lowercase words of three or more characters: the unit of belief matching. */
export function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[\p{L}\p{N}_]{3,}/gu) ?? []);
}

/**
 * Whether two sentences say about the same thing: the shorter one has at least two words and
 * 80 percent of them are in the longer one.
 */
export function sameStatement(a: string, b: string): boolean {
  const wa = words(a);
  const wb = words(b);
  const [small, large] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  if (small.size < 2) return false;
  let shared = 0;
  for (const w of small) if (large.has(w)) shared++;
  return shared / small.size >= 0.8;
}

function metSection(input: DigestInput, events: MindEvent[]): Section {
  const known = new Set(input.knownNames);
  const names = new Set<string>();
  for (const e of events) {
    if (e.type === 'speech' && !e.payload.own && !known.has(e.payload.from)) {
      names.add(e.payload.from);
    }
    if (e.type === 'wake' && e.payload.reason.startsWith('new_agent_within_')) {
      const who = e.payload.detail;
      if (who !== undefined && !known.has(who)) names.add(who);
    }
  }
  return {
    title: 'New agents met',
    lines: [...names].sort().map((n) => `- ${quoted(n, 32)}`),
  };
}

function speechSection(events: MindEvent[], heard: string[]): Section {
  const lines: string[] = [];
  for (const e of events) {
    if (e.type !== 'speech' || e.payload.own) continue;
    const line = `- t${e.tick} ${quoted(e.payload.from, 32)} said ${quoted(e.payload.text)}`;
    lines.push(line);
    heard.push(`${e.payload.from} said ${e.payload.text}`);
  }
  return { title: 'Significant speech', lines: lines.slice(0, SPEECH_MAX_LINES) };
}

function commitmentSection(input: DigestInput): Section {
  const lines: string[] = [];
  const seen = new Set<number>();
  const rows = [...input.commitments].sort((a, b) => a.memoryId - b.memoryId);
  for (const row of rows) {
    if (seen.has(row.memoryId)) continue;
    seen.add(row.memoryId);
    const text = quoted(row.text);
    if (row.resolved) lines.push(`- fulfilled: ${text}`);
    else if (row.dueTick !== null && row.dueTick < input.nowTick) lines.push(`- broken: ${text}`);
    else if (row.createdDay === input.day) lines.push(`- made: ${text}`);
  }
  return { title: 'Commitments', lines: lines.slice(0, SECTION_MAX_LINES) };
}

function failureSection(events: MindEvent[], own: string[]): Section {
  const lines: string[] = [];
  for (const e of events) {
    let line: string | null = null;
    if (
      e.type === 'intent' &&
      (e.payload.state === 'failed' || e.payload.state === 'interrupted')
    ) {
      line = `intent ${e.payload.state}: ${quoted(e.payload.detail ?? e.payload.goal ?? '', 120)}`;
    } else if (e.type === 'plan_result' && e.payload.intent === 'precondition_failed') {
      line = `plan refused: precondition failed (thought ${e.payload.thought_id})`;
    } else if (e.type === 'action' && e.payload.state === 'failed') {
      line = `action ${e.payload.kind} failed`;
    } else if (
      e.type === 'damage' ||
      (e.type === 'wake' && e.payload.reason === 'unexpected_damage')
    ) {
      line = 'took unexpected damage';
    }
    if (line === null) continue;
    lines.push(`- t${e.tick} ${line}`);
    own.push(line);
  }
  return {
    title: 'Failed intents and unexpected damage',
    lines: lines.slice(0, SECTION_MAX_LINES),
  };
}

function windfallSection(inventory: InventoryReading[], own: string[]): Section {
  const lines: string[] = [];
  const readings = [...inventory].sort((a, b) => a.tick - b.tick);
  for (let i = 1; i < readings.length; i++) {
    const before = new Map<string, number>();
    for (const s of readings[i - 1]?.items ?? []) {
      before.set(s.item, (before.get(s.item) ?? 0) + s.count);
    }
    const after = new Map<string, number>();
    for (const s of readings[i]?.items ?? []) after.set(s.item, (after.get(s.item) ?? 0) + s.count);
    for (const item of [...after.keys()].sort()) {
      const gain = (after.get(item) ?? 0) - (before.get(item) ?? 0);
      if (gain >= WINDFALL_MIN) {
        const line = `gained ${gain} ${item}`;
        lines.push(`- t${readings[i]?.tick ?? 0} ${line}`);
        own.push(line);
      }
    }
  }
  return { title: 'Windfalls', lines: lines.slice(0, SECTION_MAX_LINES) };
}

function goalSection(journal: JournalEntry[]): Section {
  const lines: string[] = [];
  let last: string | null = null;
  for (const entry of [...journal].sort((a, b) => a.worldTick - b.worldTick)) {
    const goal = entry.parsed?.intent?.goal;
    if (goal === undefined || goal === last) continue;
    lines.push(`- t${entry.worldTick} goal ${quoted(goal, 120)}`);
    last = goal;
  }
  return { title: 'Goal changes', lines: lines.slice(0, SECTION_MAX_LINES) };
}

function contradictionSection(input: DigestInput, events: MindEvent[]): Section {
  const preconditions = new Map<string, string[]>();
  for (const entry of input.journal) {
    preconditions.set(entry.thoughtId, entry.parsed?.intent?.preconditions ?? []);
  }
  const lines: string[] = [];
  for (const e of events) {
    if (e.type !== 'plan_result' || e.payload.intent !== 'precondition_failed') continue;
    for (const pre of preconditions.get(e.payload.thought_id) ?? []) {
      for (const belief of input.beliefs) {
        if (sameStatement(belief.text, pre)) {
          lines.push(
            `- t${e.tick} belief ${quoted(belief.text, 100)} vs failed precondition ${quoted(pre, 100)}`,
          );
        }
      }
    }
  }
  return { title: 'Beliefs contradicted by a failed precondition', lines: [...new Set(lines)] };
}

/** Builds the digest. Pure: equal input gives equal bytes, at most `DIGEST_MAX_BYTES`. */
export function buildDigest(input: DigestInput): Digest {
  const events = ordered(input.events.filter((e) => e.tick >= input.sinceTick));
  const own: string[] = [];
  const heard: string[] = [];
  const sections: Section[] = [
    metSection(input, events),
    speechSection(events, heard),
    commitmentSection(input),
    failureSection(events, own),
    windfallSection(
      input.inventory.filter((r) => r.tick >= input.sinceTick),
      own,
    ),
    goalSection(input.journal),
    contradictionSection(input, events),
  ];
  const marker = (dropped: number): string => `[${dropped} lines left out to fit the size cap]`;
  const flat: string[] = [`Day ${input.day}, ticks ${input.sinceTick} to ${input.nowTick}`];
  const body: { head: boolean; text: string }[] = [];
  for (const s of sections) {
    if (s.lines.length === 0) continue;
    body.push({ head: true, text: `${s.title}:` });
    for (const l of s.lines) body.push({ head: false, text: l });
  }
  const size = (parts: string[]): number => new TextEncoder().encode(parts.join('\n')).length;
  let dropped = 0;
  while (size([...flat, ...body.map((b) => b.text), marker(9999)]) > DIGEST_MAX_BYTES) {
    body.pop();
    dropped++;
  }
  while (body.length > 0 && body[body.length - 1]?.head) body.pop();
  flat.push(...body.map((b) => b.text));
  if (dropped > 0) flat.push(marker(dropped));
  return { text: flat.join('\n'), ownObservations: own, heard };
}
