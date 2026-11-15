// The StateStore over the agents and proficiency tables (sql/0050). Read only: two SELECTs, each bounded
// by the life id (the primary key of agents, and at most seven rows per life in proficiency).
import type { ProficiencyState } from '@geldar/contract';
import type { Pool } from 'pg';
import type { StateStore } from './service.ts';

const DOMAINS = ['combat', 'farming', 'mining', 'building', 'crafting', 'exploring', 'social'];

export function pgStateStore(pool: Pick<Pool, 'query'>): StateStore {
  return {
    async read(lifeId) {
      // Only the existence of the life is read: the reply carries no sheet (AN-11c, least data).
      const agent = await pool.query('SELECT agent_id FROM agents WHERE agent_id = $1', [lifeId]);
      const row = agent.rows[0];
      if (row === undefined) return null;
      const prof = await pool.query(
        'SELECT domain, xp, level FROM proficiency WHERE life_id = $1',
        [lifeId],
      );
      const levels = {} as ProficiencyState['levels'];
      for (const d of DOMAINS) levels[d as keyof typeof levels] = { level: 0, xp: 0 };
      for (const r of prof.rows) {
        if (!DOMAINS.includes(r.domain)) continue;
        levels[r.domain as keyof typeof levels] = { level: Number(r.level), xp: Number(r.xp) };
      }
      // version is recomputed by the service from the XP; the 0 here is a placeholder.
      return { life_id: lifeId, version: 0, levels };
    },
  };
}
