/**
 * The benchmark gate before `start`. The gate is the newest `bench-results/*.json` (by the timestamp in its name, not
 * its mtime). It passes when it is a complete run at HEAD in which every 20 TPS summary row is 100% successful. The
 * 10 and 5 TPS rows are recorded in the manifest but not required (decision D-P0-17). Pure: the CLI reads the folder.
 */

/** The newest result file and its text. */
export interface BenchFile {
  file: string;
  text: string;
}

/** What the manifest records about a passing gate. */
export interface BenchSummary {
  file: string;
  /** The short sha the run recorded (`meta.commit`). */
  commit: string;
  tps20: { scenario: string; successPct: number | null }[];
}

export type BenchCheck = { ok: true; summary: BenchSummary } | { ok: false; problems: string[] };

type Json = Record<string, unknown>;

/** `YYYYMMDDTHHmmssZ-<commit>.json`, as the bench writer names its files. */
const RESULT_NAME = /^(\d{8}T\d{6}Z)-([0-9a-f]{7,40})\.json$/;

const isRecord = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The newest result name by the timestamp in it, or null when no name has the result form. */
export function newestBenchFile(names: string[]): string | null {
  let best: { name: string; stamp: string } | null = null;
  for (const name of names) {
    const stamp = RESULT_NAME.exec(name)?.[1];
    if (stamp !== undefined && (best === null || stamp > best.stamp)) best = { name, stamp };
  }
  return best?.name ?? null;
}

/** Checks the gate file. Every problem is listed, each with what to do; the summary is set only when none is found. */
export function checkBench(bench: BenchFile | null, headSha: string): BenchCheck {
  if (bench === null) {
    return {
      ok: false,
      problems: [
        'benchmark gate: no bench-results/*.json file; run OPS-0 (the 20 TPS benchmark) first',
      ],
    };
  }
  const { file, text } = bench;
  const refuse = (problem: string): BenchCheck => ({
    ok: false,
    problems: [`benchmark gate: ${file} ${problem}`],
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return refuse('is not valid JSON; re-run OPS-0');
  }
  if (!isRecord(parsed) || !isRecord(parsed.meta) || typeof parsed.meta.commit !== 'string') {
    return refuse('has no meta.commit; it is not a bench result; re-run OPS-0');
  }
  if (!Array.isArray(parsed.summary)) return refuse('has no summary rows; re-run OPS-0');
  if (parsed.truncated === true) return refuse('is a truncated run; re-run OPS-0 to completion');
  if (parsed.truncated !== false) return refuse('has no truncated flag; re-run OPS-0');

  const commit = parsed.meta.commit;
  const short = headSha.slice(0, 7);
  const problems: string[] = [];
  // A bench writer may record a longer short sha than seven digits, so compare by prefix either way.
  const sameCommit =
    commit.length >= 7 && (headSha.startsWith(commit) || commit.startsWith(headSha));
  if (!sameCommit) {
    problems.push(
      `benchmark gate: ${file} was recorded at ${commit}, HEAD is ${short}; re-run OPS-0 at HEAD`,
    );
  }
  const rows20 = parsed.summary.filter((row): row is Json => isRecord(row) && row.tps === 20);
  if (rows20.length === 0)
    problems.push(`benchmark gate: ${file} has no 20 TPS rows; re-run OPS-0`);
  const tps20: BenchSummary['tps20'] = [];
  for (const row of rows20) {
    const scenario = String(row.scenario);
    const pct = typeof row.successPct === 'number' ? row.successPct : null;
    tps20.push({ scenario, successPct: pct });
    if (pct !== 100) {
      problems.push(
        `benchmark gate: 20 TPS ${scenario} is ${String(row.successPct)}% success, not 100%; re-run OPS-0`,
      );
    }
  }
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, summary: { file, commit, tps20 } };
}
