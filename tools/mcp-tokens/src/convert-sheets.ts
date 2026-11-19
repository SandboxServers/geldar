import { parse } from 'yaml';
import type { Row, Sql } from './owners.ts';
import { adoptedSheet, sheetHash } from './players.ts';

/** One line of the adoption plan. `field` names the first bad field of a refused sheet. */
export interface PlanLine {
  life: string;
  verdict: 'would-adopt' | 'same' | 'conflict' | 'refused' | 'not-found' | 'dead';
  field?: string;
}

/** The `--sheets` value: a mapping from life to sheet (or "standard"); anything else is refused. */
export function sheetsObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('--sheets must be a mapping from life to sheet');
  }
  return value as Record<string, unknown>;
}

/** One printed line of the plan: the life, its verdict, and the first bad field of a refusal. */
export function formatPlanLine(line: PlanLine): string {
  return `${line.life}: ${line.verdict}${line.field === undefined ? '' : ` (${line.field})`}`;
}

/** The lives the shard file names under `mind.lives` (the tier table); absent means none. */
export function readShardLives(text: string): string[] {
  const doc = parse(text) as { mind?: { lives?: Record<string, unknown> } } | null;
  const lives = doc?.mind?.lives ?? {};
  return Object.values(lives).filter((v): v is string => typeof v === 'string');
}

/** The first bad field of an adoptedSheet refusal: `character sheet refused: <path>: <message>; ...`. */
function firstField(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const first = text.replace(/^character sheet refused: /, '').split('; ')[0] ?? '';
  return first.split(': ')[0] ?? first;
}

/**
 * Plans the adoption of sheets for existing lives. Reads only the `agents` rows named in `sheets`
 * (agent_id, died_at, sheet_hash); writes nothing. A life outside the shard refuses the whole run.
 * `"standard"` stands for the standard sheet. The database baseline wins: a different one is a conflict.
 */
export async function planAdoption(
  sql: Sql,
  shardLives: readonly string[],
  sheets: Record<string, unknown>,
): Promise<PlanLine[]> {
  const lives = Object.keys(sheets);
  const outside = lives.filter((life) => !shardLives.includes(life));
  if (outside.length > 0) {
    throw new Error(`life ${outside[0]} is not in the shard file; the run is refused`);
  }
  const { rows } = await sql.query(
    'SELECT agent_id, died_at, sheet_hash FROM agents WHERE agent_id = ANY($1)',
    [lives],
  );
  const byLife = new Map<string, Row>(rows.map((row) => [String(row.agent_id), row]));
  const plan: PlanLine[] = [];
  for (const life of lives) {
    const row = byLife.get(life);
    if (row === undefined) {
      plan.push({ life, verdict: 'not-found' });
      continue;
    }
    if (row.died_at !== null && row.died_at !== undefined) {
      plan.push({ life, verdict: 'dead' });
      continue;
    }
    const given = sheets[life];
    let hash: string;
    try {
      hash = sheetHash(adoptedSheet(given === 'standard' ? undefined : given));
    } catch (error) {
      plan.push({ life, verdict: 'refused', field: firstField(error) });
      continue;
    }
    const baseline = row.sheet_hash;
    if (baseline === null || baseline === undefined) {
      plan.push({ life, verdict: 'would-adopt' });
    } else if (baseline === hash) {
      plan.push({ life, verdict: 'same' });
    } else {
      plan.push({ life, verdict: 'conflict' });
    }
  }
  return plan;
}
