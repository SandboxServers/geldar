/**
 * A sovereign player's journal as thought rows (decision 0138). The rows come from two read-only definer
 * functions (migration 0020) that apply the visibility rule themselves; Glass has no grant on mcp_journal.
 * A journal row has the shape of a thought row plus `kind: 'journal'` and `text`, with neutral values for the
 * fields only a Mind thought has (no template version, no outcome, no latency). `text` is agent-written and
 * untrusted: the page shows it as text only. The merge keeps the page order and the stream cursor exact.
 */
import {
  listThoughts,
  type Row,
  type SqlClient,
  type ThoughtCursor,
  type ThoughtFilter,
  thoughtsAfter,
  type Visibility,
} from './query.ts';

/** A journal function row as a thought row. */
function asThought(row: Row): Row {
  const { journal_text: text, ...rest } = row;
  return {
    ...rest,
    kind: 'journal',
    text,
    wake_reason: null,
    prompt_template_version: null,
    latency_ms: null,
    parsed: null,
  };
}

/**
 * The time of a Postgres `timestamptz::text` value in microseconds since the epoch, or null when it does not
 * parse. Text compare breaks across zone offsets, and Date has only milliseconds.
 */
export function microsOf(cursorAt: unknown): bigint | null {
  const m =
    /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)(?:\.(\d{1,6}))?(?:([+-])(\d\d)(?::?(\d\d))?|Z)?$/.exec(
      String(cursorAt),
    );
  if (m === null) return null;
  const ms = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
  );
  const offsetMin = (Number(m[9] ?? 0) * 60 + Number(m[10] ?? 0)) * (m[8] === '-' ? -1 : 1);
  const frac = (m[7] ?? '').padEnd(6, '0');
  return (BigInt(ms) - BigInt(offsetMin) * 60_000n) * 1000n + BigInt(frac);
}

/** Orders two rows by (time, id); negative when `a` is older. */
function compare(a: Row, b: Row): number {
  const x = microsOf(a.cursor_at) ?? 0n;
  const y = microsOf(b.cursor_at) ?? 0n;
  if (x !== y) return x < y ? -1 : 1;
  const i = String(a.thought_id ?? '');
  const j = String(b.thought_id ?? '');
  return i < j ? -1 : i > j ? 1 : 0;
}

/**
 * Thoughts and journal lines, newest first, one page. Both sources are read with the same cursor and limit, so
 * the merged page is the true newest `limit` of the union, and the next cursor (the last row) loses nothing.
 * The outcome filter (parsed or not) and nothing else a journal line lacks keep it out: it has no outcome.
 */
export async function listThoughtsWithJournal(
  db: SqlClient,
  filter: ThoughtFilter,
  shown: Visibility,
): Promise<Row[]> {
  const thoughts = await listThoughts(db, filter, shown);
  if (filter.outcome !== undefined) return thoughts;
  const result = await db.query(
    `SELECT j.thought_id, j.life_id, j.at, j.cursor_at, j.journal_text, j.name, j.tier
       FROM glass_journal_page($1::timestamptz, $2::text[], $3::boolean, $4::text, $5::text,
                               $6::timestamptz, $7::timestamptz, $8::text, $9::integer) j`,
    [
      shown.shownUntil,
      [...(shown.ownedAgents ?? [])],
      shown.showLivingSovereign,
      filter.lifeId ?? null,
      filter.tier ?? null,
      filter.since ?? null,
      filter.before?.at ?? null,
      filter.before?.id ?? '',
      filter.limit,
    ],
  );
  return [...thoughts, ...result.rows.map(asThought)]
    .sort((a, b) => compare(b, a))
    .slice(0, filter.limit);
}

/**
 * Thoughts and journal lines after a cursor, oldest first, at most `limit`. The `limit` smallest of the union
 * lie within the `limit` smallest of each source, so no row is skipped when the caller moves its cursor to the
 * last row returned. The shared stream keeps the delay for every row.
 */
export async function thoughtsAndJournalAfter(
  db: SqlClient,
  after: ThoughtCursor,
  limit: number,
  shown: Visibility,
): Promise<Row[]> {
  const thoughts = await thoughtsAfter(db, after, limit, shown);
  const result = await db.query(
    `SELECT j.thought_id, j.life_id, j.at, j.cursor_at, j.journal_text, j.name, j.tier
       FROM glass_journal_after($1::timestamptz, $2::text, $3::timestamptz, $4::boolean,
                                $5::integer) j`,
    [after.at, after.id, shown.shownUntil, shown.showLivingSovereign, limit],
  );
  return [...thoughts, ...result.rows.map(asThought)].sort((a, b) => compare(a, b)).slice(0, limit);
}
