/**
 * The one-way-door gate: a migration that creates an immutable, append-only,
 * monotonic, no-update or no-delete trigger is a state change that cannot be
 * undone, so the decision that covers it must be Accepted. The migration's
 * header comment (the `--` lines before its first code line) names the decisions
 * it relies on; each named record's Status line must say Accepted or start with
 * Decided. The migration's own number is skipped, and a named number with no
 * record is a warning, not a failure. A file on the allow-list is skipped, and an
 * allow-list entry that no longer exists or no longer fails the rule fails the
 * gate, so the list cannot outlive its reason.
 */
export const ONE_WAY_DOOR_ALLOWLIST = 'tools/repo-checks/src/one-way-door-allowlist.json';

const DECISIONS_DIR = 'docs/decisions/';
const SQL_FILE = /^sql\/.+\.sql$/;
const GUARDED_TRIGGER = /immutable|append_only|monotonic|no_update|no_delete/i;
const TRIGGER_DDL = /\bCREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+(\w+)/gi;
const FOUR_DIGITS = /\b(\d{4})\b/g;
const RECORD_NAME = /^(\d{4})-[^/]*\.md$/;
const STATUS_LINE = /^(- )?Status:/i;

export interface OneWayDoorAllowEntry {
  path: string;
  decision: string;
  note: string;
}

export interface OneWayDoorResult {
  problems: string[];
  warnings: string[];
  info: string[];
}

interface DecisionRecord {
  title: string;
  status: string | undefined;
}

interface SqlFinding {
  triggers: string[];
  failures: string[];
  warnings: string[];
}

/** The names of the triggers in a migration that match the guarded words; comment lines are ignored. */
export function guardedTriggers(sql: string): string[] {
  const code = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  return [...code.matchAll(TRIGGER_DDL)]
    .map((match) => match[1] ?? '')
    .filter((name) => GUARDED_TRIGGER.test(name));
}

/** The 4-digit numbers on the header lines that mention "decision", in file order. */
export function headerDecisions(sql: string): string[] {
  const numbers = new Set<string>();
  for (const line of sql.split('\n')) {
    const text = line.trim();
    if (text === '') continue;
    if (!text.startsWith('--')) break;
    if (!/decision/i.test(text)) continue;
    for (const match of text.matchAll(FOUR_DIGITS)) numbers.add(match[1] ?? '');
  }
  return [...numbers];
}

/** A record is Accepted when its status says so, or starts with Decided. */
export function isAccepted(status: string): boolean {
  return status.includes('Accepted') || status.startsWith('Decided');
}

function recordsByNumber(files: { path: string; text: string }[]): Map<string, DecisionRecord> {
  const records = new Map<string, DecisionRecord>();
  for (const file of files) {
    if (!file.path.startsWith(DECISIONS_DIR)) continue;
    const number = RECORD_NAME.exec(file.path.slice(DECISIONS_DIR.length))?.[1];
    if (number === undefined || records.has(number)) continue;
    const lines = file.text.split('\n');
    const heading = lines.find((line) => /^#\s/.test(line)) ?? '';
    const title =
      heading
        .replace(/^#\s+/, '')
        .replace(/^\d{4}\.\s*/, '')
        .trim() || '(no heading)';
    const statusLine = lines.find((line) => STATUS_LINE.test(line));
    const status = statusLine?.replace(STATUS_LINE, '').trim();
    records.set(number, { title, status });
  }
  return records;
}

function evaluateSql(
  file: { path: string; text: string },
  records: Map<string, DecisionRecord>,
): SqlFinding {
  const triggers = guardedTriggers(file.text);
  const finding: SqlFinding = { triggers, failures: [], warnings: [] };
  if (triggers.length === 0) return finding;
  const own = /^(\d{4})/.exec(file.path.split('/').pop() ?? '')?.[1];
  for (const number of headerDecisions(file.text)) {
    if (number === own) continue;
    const record = records.get(number);
    if (record === undefined) {
      finding.warnings.push(
        `${file.path}: decision ${number} has no record in ${DECISIONS_DIR} (not checked)`,
      );
      continue;
    }
    if (record.status !== undefined && isAccepted(record.status)) continue;
    const status = record.status ?? '(no Status line)';
    finding.failures.push(
      `${file.path} (trigger ${triggers.join(', ')}): ${number} ${record.title} -- status: ${status}`,
    );
  }
  return finding;
}

function isEntry(value: unknown): value is OneWayDoorAllowEntry {
  if (typeof value !== 'object' || value === null) return false;
  const { path, decision, note } = value as Record<string, unknown>;
  return (
    typeof path === 'string' &&
    typeof decision === 'string' &&
    /^\d{4}$/.test(decision) &&
    typeof note === 'string' &&
    note.trim() !== ''
  );
}

/**
 * Parses `one-way-door-allowlist.json`. A missing list means no exemptions, so every
 * failing migration still fails; a list that exists but is malformed is a problem.
 */
export function parseOneWayDoorAllowlist(
  text: string | undefined,
  path: string,
): { entries: OneWayDoorAllowEntry[]; problems: string[] } {
  if (text === undefined) return { entries: [], problems: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { entries: [], problems: [`${path} is not valid JSON: ${(error as Error).message}`] };
  }
  const list = (parsed as { exemptions?: unknown } | null)?.exemptions;
  if (!Array.isArray(list))
    return { entries: [], problems: [`${path} needs an "exemptions" array`] };
  const entries: OneWayDoorAllowEntry[] = [];
  const problems: string[] = [];
  list.forEach((item, index) => {
    if (isEntry(item)) entries.push(item);
    else
      problems.push(
        `${path} entry ${index} needs a path, a 4-digit decision and a note (the reason)`,
      );
  });
  return { entries, problems };
}

/**
 * Runs the rule over every `sql/*.sql` file. Returns the failing decisions and
 * the stale allow-list entries as problems, the missing records as warnings, and
 * one info line per allow-listed file that the rule skipped.
 */
export function checkOneWayDoor(
  files: { path: string; text: string }[],
  allowlistText: string | undefined,
  allowlistPath: string = ONE_WAY_DOOR_ALLOWLIST,
): OneWayDoorResult {
  const allowlist = parseOneWayDoorAllowlist(allowlistText, allowlistPath);
  const result: OneWayDoorResult = { problems: [...allowlist.problems], warnings: [], info: [] };
  const records = recordsByNumber(files);
  const allowed = new Set(allowlist.entries.map((entry) => entry.path));
  const sqlFiles = files.filter((file) => SQL_FILE.test(file.path));
  for (const file of sqlFiles) {
    const finding = evaluateSql(file, records);
    if (finding.triggers.length === 0) continue;
    if (allowed.has(file.path)) {
      result.info.push(`${file.path} is allow-listed in ${allowlistPath} (rule skipped)`);
      continue;
    }
    result.problems.push(...finding.failures);
    result.warnings.push(...finding.warnings);
  }
  for (const entry of allowlist.entries) {
    const file = sqlFiles.find((candidate) => candidate.path === entry.path);
    if (file === undefined) {
      result.problems.push(
        `${allowlistPath} lists ${entry.path}, which no longer exists (remove the entry)`,
      );
    } else if (evaluateSql(file, records).failures.length === 0) {
      result.problems.push(
        `${allowlistPath} lists ${entry.path}, which no longer fails the one-way-door rule (remove the entry)`,
      );
    }
  }
  return result;
}
