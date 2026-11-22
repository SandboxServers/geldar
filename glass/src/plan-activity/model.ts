/**
 * The plan-activity view model (decision 0429). It takes one `plan_progress` payload (contract/schemas/
 * plan-progress-event.schema.json) and the agent label Glass already shows, and keeps counts, phase and
 * failure codes only. The fields are copied one by one, so any other key in a payload is dropped here: the
 * seen map and unseen cells never reach this module, and nothing a payload carries beyond its counts is shown.
 */

export const PLAN_PHASES = [
  'running',
  'paused',
  'waiting_materials',
  'waiting_tps',
  'idle',
  'completed',
  'failed',
] as const;

export type PlanPhase = (typeof PLAN_PHASES)[number];

export interface FailureCount {
  code: string;
  count: number;
}

/** One line of the panel: the builder's agent label and the plan's counts. */
export interface PlanActivityRow {
  agent: string;
  plan: string;
  phase: PlanPhase;
  total: number;
  done: number;
  placed: number;
  broken: number;
  /** Skipped cells by failure code, the largest first. */
  failures: FailureCount[];
}

const CODE = /^[a-z][a-z_]{0,63}$/;

function count(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`plan_progress ${field} must be a non-negative integer`);
  }
  return value;
}

function failures(value: unknown): FailureCount[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('plan_progress skipped_by_code must be an object');
  }
  const rows: FailureCount[] = [];
  for (const [code, n] of Object.entries(value)) {
    if (!CODE.test(code)) throw new Error('plan_progress failure code is not a code name');
    const total = count(n, `skipped_by_code.${code}`);
    if (total > 0) rows.push({ code, count: total });
  }
  return rows.sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

/**
 * Builds the row for one payload. A payload that does not match the schema throws, so a bad event never
 * draws a half-made line.
 */
export function toPlanActivityRow(agent: string, payload: unknown): PlanActivityRow {
  if (payload === null || typeof payload !== 'object') {
    throw new Error('plan_progress payload must be an object');
  }
  const p = payload as Record<string, unknown>;
  if (typeof p.plan_id !== 'string' || p.plan_id.length === 0) {
    throw new Error('plan_progress plan_id must be a non-empty string');
  }
  if (typeof p.phase !== 'string' || !(PLAN_PHASES as readonly string[]).includes(p.phase)) {
    throw new Error('plan_progress phase is not a known phase');
  }
  return {
    agent,
    plan: p.plan_id,
    phase: p.phase as PlanPhase,
    total: count(p.total, 'total'),
    done: count(p.done, 'done'),
    placed: count(p.placed, 'placed'),
    broken: count(p.broken, 'broken'),
    failures: failures(p.skipped_by_code),
  };
}

/** The panel's text lines. Plain text only: the page sets it with textContent, never as markup. */
export function planActivityLines(rows: readonly PlanActivityRow[]): string[] {
  return rows.map((row) => {
    const fails = row.failures.map((f) => `${f.code} ${f.count}`).join(', ') || 'none';
    return (
      `${row.agent} · plan ${row.plan} · ${row.phase} · ${row.done}/${row.total} done` +
      ` · placed ${row.placed} · broken ${row.broken} · skipped: ${fails}`
    );
  });
}
