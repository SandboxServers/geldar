import type { Pool } from 'pg';
import type { BudgetLedger } from '../ports.ts';

const MS_PER_HOUR = 3_600_000;

/** The accrual settings from `sovereign.budget` (spec 5.7). */
export interface AccrualRules {
  creditsPerRealHour: number;
  capCredits: number;
}

/** A life's stored balance and the instant up to which its accrual has been credited. */
export interface BudgetState {
  credits: number;
  accruedAtMs: number;
}

/**
 * The state after accrual at `nowMs`. Only whole credits are minted, and the accrual clock moves
 * forward by exactly the time those credits took, so no fraction is lost. At the cap the clock
 * jumps to now: time spent full is not banked. Mirrors the SQL in `ACCRUE_SQL` below.
 */
export function accrue(state: BudgetState, nowMs: number, rules: AccrualRules): BudgetState {
  const elapsedMs = Math.max(0, nowMs - state.accruedAtMs);
  const whole = Math.floor((elapsedMs * rules.creditsPerRealHour) / MS_PER_HOUR);
  if (state.credits + whole >= rules.capCredits) {
    return { credits: rules.capCredits, accruedAtMs: nowMs };
  }
  return {
    credits: state.credits + whole,
    accruedAtMs: state.accruedAtMs + (whole * MS_PER_HOUR) / rules.creditsPerRealHour,
  };
}

/** The reserve rule: the cost is taken only when the balance covers it. */
export function takeCredits(balance: number, cost: number): { ok: boolean; remaining: number } {
  if (balance >= cost) return { ok: true, remaining: balance - cost };
  return { ok: false, remaining: balance };
}

/*
 * Accrual in one statement. $1 life_id, $2 now (timestamptz), $3 credits per real hour, $4 cap.
 * Whole credits only, as accrue() does: seconds * rate / 3600, and the clock moves by the time
 * those credits took. A row at the cap takes the clock to now.
 */
const ACCRUE_CTE = `WITH cur AS (
  SELECT life_id, credits, accrued_at,
    FLOOR(GREATEST(EXTRACT(EPOCH FROM ($2::timestamptz - accrued_at)), 0)
      * $3::int / 3600)::int AS whole
  FROM mcp_budget WHERE life_id = $1
), acc AS (
  SELECT life_id, accrued_at, LEAST($4::int, credits + whole) AS capped,
    CASE WHEN credits + whole >= $4::int THEN $2::timestamptz
      ELSE accrued_at + make_interval(secs => (whole * 3600.0 / $3::int)::double precision)
    END AS clock
  FROM cur
)`;

/**
 * Credits per life in `mcp_budget`. Accrual, and the reserve it precedes, happen in one statement,
 * so two concurrent reserves cannot overspend: the guard is the row's own `credits >= cost`.
 */
export class PgBudgetLedger implements BudgetLedger {
  private readonly pool: Pool;
  private readonly rules: AccrualRules;

  constructor(pool: Pool, rules: AccrualRules) {
    if (!(rules.creditsPerRealHour > 0)) throw new Error('credits_per_real_hour must be above 0');
    this.pool = pool;
    this.rules = rules;
  }

  async balance(lifeId: string, nowMs: number): Promise<number> {
    const { rows } = await this.pool.query<{ credits: number }>(
      `${ACCRUE_CTE} UPDATE mcp_budget b SET credits = acc.capped, accrued_at = acc.clock
       FROM acc WHERE b.life_id = acc.life_id RETURNING b.credits`,
      this.accrueParams(lifeId, nowMs),
    );
    return rows[0]?.credits ?? 0;
  }

  async reserve(
    lifeId: string,
    credits: number,
    nowMs: number,
  ): Promise<{ ok: boolean; remaining: number }> {
    const { rows } = await this.pool.query<{ remaining: number; ok: boolean }>(
      `${ACCRUE_CTE} UPDATE mcp_budget b
       SET credits = acc.capped - CASE WHEN acc.capped >= $5::int THEN $5::int ELSE 0 END,
           accrued_at = acc.clock
       FROM acc WHERE b.life_id = acc.life_id
       RETURNING b.credits AS remaining, acc.capped >= $5::int AS ok`,
      [...this.accrueParams(lifeId, nowMs), credits],
    );
    const row = rows[0];
    if (row === undefined) return { ok: false, remaining: 0 };
    return { ok: row.ok, remaining: row.remaining };
  }

  async refund(lifeId: string, credits: number): Promise<number> {
    const { rows } = await this.pool.query<{ credits: number }>(
      `UPDATE mcp_budget SET credits = LEAST($3::int, credits + $2::int)
       WHERE life_id = $1 RETURNING credits`,
      [lifeId, credits, this.rules.capCredits],
    );
    return rows[0]?.credits ?? 0;
  }

  private accrueParams(lifeId: string, nowMs: number): unknown[] {
    return [lifeId, new Date(nowMs), this.rules.creditsPerRealHour, this.rules.capCredits];
  }
}
