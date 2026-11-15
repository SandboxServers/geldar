import { createHash } from 'node:crypto';

/**
 * `wait` deduplicates two sections of its play view within one MCP session (decision 0221): the
 * recipe list and the notable blocks. The first wait of a session is full, and so is every
 * `WAIT_DELTA_FULL_EVERY`th wait after it.
 */
export const WAIT_DELTA_FULL_EVERY = 10;

/** The lives the feature is on for: `all`, or a set of life ids. Off when empty. */
export interface WaitDeltaLives {
  readonly all: boolean;
  readonly lives: ReadonlySet<string>;
}

export const WAIT_DELTA_OFF: WaitDeltaLives = { all: false, lives: new Set() };

/**
 * Reads GELDAR_WAIT_DELTA_LIVES: a comma list of life ids, or `all`. Unset or empty is off. Called
 * once at startup; the result is not read again.
 */
export function parseWaitDeltaLives(raw: string | undefined): WaitDeltaLives {
  const items = (raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (items.includes('all')) return { all: true, lives: new Set() };
  return { all: false, lives: new Set(items) };
}

/** True when the feature is on for this life. */
export function waitDeltaOn(lives: WaitDeltaLives | undefined, lifeId: string): boolean {
  return lives !== undefined && (lives.all || lives.lives.has(lifeId));
}

/** What a session last received for one life: the cursor, the section digests and the wait count. */
export interface SentMark {
  session: string;
  cursor: string;
  /** Digest of each deduplicated section as the agent holds it in full; absent when not safe to match. */
  hashes: { unlocked_recipes?: string; notable_blocks?: string };
  /** Canonical JSON of `self.position` in the last result. */
  position: string;
  /** Waits this session has made so far for the life. */
  count: number;
}

/** The sections of a play view `wait` may replace with the unchanged fact. */
export interface DeltaSections {
  self: { unlocked_recipes?: unknown; position?: unknown };
  surroundings: { notable_blocks?: unknown };
}

export interface DeltaInput {
  lifeId: string;
  /** The MCP session that asked; absent means no session, so nothing is matched. */
  session: string | undefined;
  /** The cursor the request carried. */
  cursor: string | undefined;
  /** The cursor this result carries. */
  resultCursor: string;
  /** Sections that fitResult cut down; a cut section is never marked unchanged. */
  trimmed: { unlocked_recipes: boolean; notable_blocks: boolean };
}

/** Sorted-key JSON, so the same value always gives the same text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const body = keys.map(
      (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
    );
    return `{${body.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/** How many lives keep a sent mark; the oldest is forgotten past this. */
export const MAX_SENT_LIVES = 1_024;

/** Records the mark for a life; the map keeps at most MAX_SENT_LIVES lives. */
export function rememberSent(sent: Map<string, SentMark>, lifeId: string, mark: SentMark): void {
  sent.delete(lifeId);
  sent.set(lifeId, mark);
  while (sent.size > MAX_SENT_LIVES) {
    const oldest = sent.keys().next().value;
    if (oldest === undefined) break;
    sent.delete(oldest);
  }
}

/**
 * Replaces an unchanged recipe list or notable-block list in `sections` with the unchanged fact,
 * and records what this result carried. A section is replaced only when the request carries the
 * cursor this session was last given, this is not a full-every wait, the section is not cut, and
 * its digest (and, for notable blocks, the position) equals the last one sent. Otherwise the full
 * section stays. Off lives and sessionless calls are left as they are.
 */
export function applyWaitDelta(
  sent: Map<string, SentMark>,
  input: DeltaInput,
  sections: DeltaSections,
  on: boolean,
): void {
  if (!on || input.session === undefined) return;
  const prev = sent.get(input.lifeId);
  const sameSession = prev !== undefined && prev.session === input.session;
  const count = (sameSession ? prev.count : 0) + 1;
  const sameCursor = sameSession && prev.cursor === input.cursor;
  const fullTurn = count % WAIT_DELTA_FULL_EVERY === 0;
  const position = canonicalJson(sections.self.position);
  const positionSame = sameSession && prev.position === position;
  const hashes: SentMark['hashes'] = {};

  const unlocked = sections.self.unlocked_recipes;
  if (Array.isArray(unlocked)) {
    const current = digest(unlocked);
    const replace =
      sameCursor &&
      !fullTurn &&
      !input.trimmed.unlocked_recipes &&
      prev.hashes.unlocked_recipes === current;
    if (replace) sections.self.unlocked_recipes = { unchanged: true, count: unlocked.length };
    if (!input.trimmed.unlocked_recipes) hashes.unlocked_recipes = current;
  }

  const notable = sections.surroundings.notable_blocks;
  if (Array.isArray(notable)) {
    const current = digest(notable);
    const replace =
      sameCursor &&
      !fullTurn &&
      !input.trimmed.notable_blocks &&
      positionSame &&
      prev.hashes.notable_blocks === current;
    if (replace) sections.surroundings.notable_blocks = { unchanged: true, count: notable.length };
    if (!input.trimmed.notable_blocks) hashes.notable_blocks = current;
  }

  rememberSent(sent, input.lifeId, {
    session: input.session,
    cursor: input.resultCursor,
    hashes,
    position,
    count,
  });
}
