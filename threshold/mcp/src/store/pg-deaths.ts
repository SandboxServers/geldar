import type { Pool } from 'pg';
import type { DeathMark, DeathMarks } from '../ports.ts';

interface DeathRow {
  death_count: number | null;
  last_death_day: number | null;
}

const READ_SQL = `SELECT death_count, last_death_day FROM mcp_life_deaths WHERE life_id = $1`;
// One statement: the event id is inserted once (ON CONFLICT DO NOTHING), and the count rises only
// for an insert that happened, so a repeated death event changes nothing (migration 0023).
const RECORD_SQL = `WITH fresh AS (
  INSERT INTO mcp_death_events (event_id, life_id) VALUES ($1, $2)
  ON CONFLICT (event_id) DO NOTHING RETURNING life_id
)
INSERT INTO mcp_life_deaths (life_id, death_count, last_death_day, last_death_at)
SELECT life_id, 1, $3, now() FROM fresh
ON CONFLICT (life_id) DO UPDATE SET death_count = mcp_life_deaths.death_count + 1,
  last_death_day = EXCLUDED.last_death_day, last_death_at = EXCLUDED.last_death_at`;

/** The death count of each life, in mcp_life_deaths (migration 0023). */
export class PgDeathStore implements DeathMarks {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async read(lifeId: string): Promise<DeathMark> {
    const { rows } = await this.pool.query<DeathRow>(READ_SQL, [lifeId]);
    const [row] = rows;
    if (row === undefined) return { deaths: 0, lastDeathDay: null };
    return { deaths: Number(row.death_count ?? 0), lastDeathDay: row.last_death_day ?? null };
  }

  async recordDeath(lifeId: string, eventId: string, day: number): Promise<void> {
    await this.pool.query(RECORD_SQL, [eventId, lifeId, day]);
  }
}
