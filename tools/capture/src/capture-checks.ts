import {
  validateCombatFactPayload,
  validateProvenance,
  validateWorldEvent,
} from '@geldar/contract';

// CAP-1: checks one captured message against the contract. Pure: no file or network access (validate-captures.ts does I/O).

/** The case a capture belongs to: the subject kind. AN-27a is `break`, AN-26a `pickup`, AN-51a `take`, AN-47a `combat_fact`. */
export type CaseKind = 'break' | 'pickup' | 'take' | 'combat' | 'combat_fact';

export const CASE_KINDS: readonly CaseKind[] = ['break', 'pickup', 'take', 'combat', 'combat_fact'];

export type CheckRow = {
  case: string;
  file: string;
  /** pass/fail of the schema; n/a on a claim row, which is printed next to the schema row of its file. */
  schema: 'pass' | 'fail' | 'n/a';
  result: 'pass' | 'fail';
  detail: string;
};

/** One captured file: its name, its subject (from the sidecar) and its text, exactly as received. */
export type CaptureEntry = { file: string; subject: string; text: string };

const PROVENANCE_SUBJECT = /^geldar\.[a-z][a-z0-9-]{1,31}\.provenance\.(break|pickup|take|combat)$/;
const COMBAT_FACT_SUBJECT = /^geldar\.[a-z][a-z0-9-]{1,31}\.combat_fact$/;

/** The case of a subject, or null for a subject the session does not capture. */
export function subjectKind(subject: string): CaseKind | null {
  const provenance = PROVENANCE_SUBJECT.exec(subject);
  if (provenance?.[1]) return provenance[1] as CaseKind;
  if (COMBAT_FACT_SUBJECT.test(subject)) return 'combat_fact';
  return null;
}

/** Parses `break=2,combat_fact=1`. Throws on an unknown case or a count that is not a non-negative integer. */
export function parseExpect(spec: string): Map<CaseKind, number> {
  const expected = new Map<CaseKind, number>();
  for (const part of spec.split(',')) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    const [name, count] = trimmed.split('=');
    if (!CASE_KINDS.includes(name as CaseKind)) throw new Error(`--expect: unknown case "${name}"`);
    const n = Number(count);
    if (count === undefined || !Number.isInteger(n) || n < 0)
      throw new Error(`--expect: bad count in "${trimmed}"`);
    expected.set(name as CaseKind, n);
  }
  return expected;
}

function row(
  kase: string,
  file: string,
  schema: CheckRow['schema'],
  result: CheckRow['result'],
  detail: string,
) {
  return { case: kase, file, schema, result, detail } satisfies CheckRow;
}

function errorText(errors: string[]): string {
  return errors.slice(0, 3).join('; ');
}

/** Checks one captured file. Returns one schema row, plus the claim rows of its case. */
export function checkCapture(entry: CaptureEntry): CheckRow[] {
  const kind = subjectKind(entry.subject);
  if (kind === null)
    return [row('?', entry.file, 'n/a', 'fail', `unknown subject ${entry.subject}`)];
  let json: unknown;
  try {
    json = JSON.parse(entry.text);
  } catch (error) {
    return [row(kind, entry.file, 'fail', 'fail', `not JSON: ${String(error)}`)];
  }
  if (kind === 'combat_fact') return checkCombatFact(entry.file, json);
  // validateProvenance is the generated ajv function (it returns a boolean and keeps its errors on .errors).
  if (!validateProvenance(json)) {
    const errors = (validateProvenance.errors ?? []).map((e) =>
      `${e.instancePath || '/'} ${e.message ?? ''}`.trim(),
    );
    return [row(kind, entry.file, 'fail', 'fail', errorText(errors))];
  }
  return [
    row(
      kind,
      entry.file,
      'pass',
      'pass',
      describeProvenance(kind, json as Record<string, unknown>),
    ),
  ];
}

/** The print-only details: AN-27a's prior_owner, AN-51a's item and count. They are printed, never judged. */
function describeProvenance(kind: CaseKind, value: Record<string, unknown>): string {
  if (kind === 'break') return `prior_owner=${JSON.stringify(value.prior_owner ?? null)}`;
  if (kind === 'take') return `item=${String(value.item)} count=${String(value.count)}`;
  return `kind=${String(value.kind ?? '-')}`;
}

/** The combat_fact envelope is a WorldEvent (the stream message). Its payload is checked on its own too. */
function checkCombatFact(file: string, json: unknown): CheckRow[] {
  const envelope = validateWorldEvent(json);
  if (!envelope.ok) return [row('combat_fact', file, 'fail', 'fail', errorText(envelope.errors))];
  const event = envelope.value;
  if (event.type !== 'combat_fact') {
    return [
      row('combat_fact', file, 'fail', 'fail', `envelope type is "${event.type}", not combat_fact`),
    ];
  }
  const payload = validateCombatFactPayload(event.payload);
  if (!payload.ok) return [row('combat_fact', file, 'fail', 'fail', errorText(payload.errors))];
  const body = payload.value as unknown as Record<string, unknown>;
  const rows = [row('combat_fact', file, 'pass', 'pass', `kind=${String(body.kind)}`)];
  // Claim (AN-47a): the real payload carries the `player` key that the schema now accepts.
  const hasPlayer = Object.hasOwn(body, 'player');
  rows.push(
    row('combat_fact', file, 'n/a', hasPlayer ? 'pass' : 'fail', `player key present=${hasPlayer}`),
  );
  // Claim (decision 0321): the encounter key's life part equals life_id.
  const key = String(body.encounter_key);
  const keyLife = key.slice(4, key.lastIndexOf(':'));
  const same = keyLife === body.life_id;
  rows.push(
    row(
      'combat_fact',
      file,
      'n/a',
      same ? 'pass' : 'fail',
      `encounter life ${keyLife} vs life_id ${String(body.life_id)}`,
    ),
  );
  return rows;
}

/** Judges the expected counts: one row per case, failing when a case has fewer schema rows than expected. */
export function checkExpect(rows: CheckRow[], expected: Map<CaseKind, number>): CheckRow[] {
  const out: CheckRow[] = [];
  for (const [kase, want] of expected) {
    const found = rows.filter((r) => r.case === kase && r.schema !== 'n/a').length;
    // CAP-2: an expected zero is exact (a send-nothing case must capture nothing); any other count is "at least".
    const ok = want === 0 ? found === 0 : found >= want;
    // A failing zero says "none" (CAP-1's pass text for a zero stays as it was).
    const detail =
      want === 0 && !ok
        ? `expected none, found ${found}`
        : `expected at least ${want}, found ${found}`;
    out.push(row(kase, '-', 'n/a', ok ? 'pass' : 'fail', detail));
  }
  return out;
}

/** The pass/fail table the CLI prints: case, file, schema, result, detail. */
export function formatTable(rows: CheckRow[]): string {
  const header = ['case', 'file', 'schema', 'result', 'detail'];
  const lines = rows.map((r) => [r.case, r.file, r.schema, r.result, r.detail]);
  const widths = header.map((h, i) => Math.max(h.length, ...lines.map((l) => (l[i] ?? '').length)));
  const fmt = (cells: string[]) =>
    cells
      .map((c, i) => c.padEnd(widths[i] ?? 0))
      .join('  ')
      .trimEnd();
  return [fmt(header), fmt(widths.map((w) => '-'.repeat(w))), ...lines.map(fmt)].join('\n');
}
