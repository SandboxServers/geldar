import type { SpeechIdentity } from '@geldar/animus/src/attention/classify.ts';
import type { Pool } from 'pg';
import type { AgentProfile, AgentProfiles, SleepMark, SleepMarks } from '../ports.ts';

interface AgentRow {
  personality_seed: string | null;
  born_day: number | null;
  last_sleep_day: number | null;
}

const PROFILE_SQL = `SELECT personality_seed, born_day, last_sleep_day
FROM agents WHERE agent_id = $1`;
const IDENTITY_SQL = `SELECT name, game_account FROM agents WHERE agent_id = $1`;
const LIVE_SQL = `SELECT agent_id FROM agents WHERE died_at IS NULL ORDER BY agent_id`;
const SLEEP_SQL = `UPDATE agents SET last_sleep_day = $2 WHERE agent_id = $1`;

/**
 * The per-life facts the MCP reads from the `agents` row: the profile for `self`, the sleep mark
 * and the list of living lives for the stream's day_night fan-out. The sleep cursor has no column
 * yet, so `read` returns cursor 0 and `write` keeps only the day (see the WM-11b report).
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
    const row = await this.row(lifeId);
    return { personality_seed: row.personality_seed ?? '', born_day: row.born_day ?? 0 };
  }

  async read(lifeId: string): Promise<SleepMark> {
    const row = await this.row(lifeId);
    return { lastSleepDay: row.last_sleep_day ?? row.born_day ?? 0, cursor: 0 };
  }

  async write(lifeId: string, mark: SleepMark): Promise<void> {
    await this.pool.query(SLEEP_SQL, [lifeId, mark.lastSleepDay]);
  }

  private async row(lifeId: string): Promise<AgentRow> {
    const { rows } = await this.pool.query<AgentRow>(PROFILE_SQL, [lifeId]);
    const [row] = rows;
    if (row === undefined) throw new Error(`no agent row for life ${lifeId}`);
    return row;
  }
}
