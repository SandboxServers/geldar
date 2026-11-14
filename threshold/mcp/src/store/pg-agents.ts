import type { SpeechIdentity } from '@geldar/player-core/src/attention/classify.ts';
import type { Pool } from 'pg';
import type { AgentProfile, AgentProfiles, SleepMark, SleepMarks } from '../ports.ts';

interface AgentRow {
  personality_seed: string | null;
  born_day: number | null;
}

interface SleepRow {
  born_day: number | null;
  last_sleep_day: number | null;
  sleep_cursor: string | null;
}

const PROFILE_SQL = `SELECT personality_seed, born_day FROM agents WHERE agent_id = $1`;
const IDENTITY_SQL = `SELECT name, game_account FROM agents WHERE agent_id = $1`;
const LIVE_SQL = `SELECT agent_id FROM agents WHERE died_at IS NULL ORDER BY agent_id`;
// The sleep mark is in mcp_sleep_marks (migration 0003): geldar_mcp may not write agents.
const SLEEP_READ_SQL = `SELECT a.born_day, m.last_sleep_day, m.sleep_cursor
FROM agents a LEFT JOIN mcp_sleep_marks m ON m.life_id = a.agent_id WHERE a.agent_id = $1`;
const SLEEP_WRITE_SQL = `INSERT INTO mcp_sleep_marks (life_id, last_sleep_day, sleep_cursor, updated_at)
VALUES ($1, $2, $3, now())
ON CONFLICT (life_id) DO UPDATE SET last_sleep_day = EXCLUDED.last_sleep_day,
  sleep_cursor = EXCLUDED.sleep_cursor, updated_at = now()`;

/**
 * The per-life facts the MCP reads from the `agents` row (the profile for `self`, the list of
 * living lives for the day_night fan-out) and its own sleep mark (`mcp_sleep_marks`).
 */
export class PgAgentStore implements AgentProfiles, SleepMarks {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /** The living lives, by life id. */
  async liveLifeIds(): Promise<string[]> {
    const { rows } = await this.pool.query<{ agent_id: string }>(LIVE_SQL);
    return rows.map((row) => row.agent_id);
  }

  /** The life's name and in-world account (`game_account`, its username), for classifying speech. */
  async identity(lifeId: string): Promise<SpeechIdentity> {
    const { rows } = await this.pool.query<{ name: string; game_account: string }>(IDENTITY_SQL, [
      lifeId,
    ]);
    const [row] = rows;
    if (row === undefined) throw new Error(`no agent row for life ${lifeId}`);
    return { name: row.name, username: row.game_account };
  }

  async profile(lifeId: string): Promise<AgentProfile> {
    const { rows } = await this.pool.query<AgentRow>(PROFILE_SQL, [lifeId]);
    const [row] = rows;
    if (row === undefined) throw new Error(`no agent row for life ${lifeId}`);
    return { personality_seed: row.personality_seed ?? '', born_day: row.born_day ?? 0 };
  }

  async read(lifeId: string): Promise<SleepMark> {
    const { rows } = await this.pool.query<SleepRow>(SLEEP_READ_SQL, [lifeId]);
    const [row] = rows;
    if (row === undefined) throw new Error(`no agent row for life ${lifeId}`);
    return {
      lastSleepDay: row.last_sleep_day ?? row.born_day ?? 0,
      cursor: Number(row.sleep_cursor ?? 0),
    };
  }

  async write(lifeId: string, mark: SleepMark): Promise<void> {
    await this.pool.query(SLEEP_WRITE_SQL, [lifeId, mark.lastSleepDay, mark.cursor]);
  }
}
