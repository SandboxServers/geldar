// The XpStore over one transaction's client (card AN-10a). Every method is one statement on that client.
import type { PoolClient } from 'pg';
import type { XpStore } from './ledger.ts';

export function pgXpStore(client: PoolClient): XpStore {
  return {
    async lifeExists(lifeId) {
      const { rows } = await client.query('SELECT 1 FROM agents WHERE agent_id = $1', [lifeId]);
      return rows.length > 0;
    },
    async insertEvidence(a) {
      const { rows } = await client.query(
        `INSERT INTO xp_evidence (life_id, domain, evidence_key, source_event_id, world_tick)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (life_id, domain, evidence_key) DO NOTHING
         RETURNING 1`,
        [a.lifeId, a.domain, a.evidenceKey, a.sourceEventId, String(a.worldTick)],
      );
      return rows.length === 1;
    },
    async bump(lifeId, domain, tick) {
      const { rows } = await client.query(
        `INSERT INTO proficiency (life_id, domain, xp, level, updated_tick)
         VALUES ($1, $2, 1, 0, $3)
         ON CONFLICT (life_id, domain) DO UPDATE
           SET xp = proficiency.xp + 1,
               updated_tick = GREATEST(proficiency.updated_tick, EXCLUDED.updated_tick)
         RETURNING xp`,
        [lifeId, domain, String(tick)],
      );
      return { xp: Number(rows[0]?.xp) };
    },
    async setLevel(lifeId, domain, level) {
      await client.query('UPDATE proficiency SET level = $3 WHERE life_id = $1 AND domain = $2', [
        lifeId,
        domain,
        level,
      ]);
    },
    async totalXp(lifeId) {
      const { rows } = await client.query(
        'SELECT COALESCE(SUM(xp), 0)::int AS total FROM proficiency WHERE life_id = $1',
        [lifeId],
      );
      return Number(rows[0]?.total);
    },
    async enqueueLevel(lifeId, domain, level, xp, version) {
      await client.query(
        `INSERT INTO proficiency_outbox (life_id, domain, level, xp, version)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (life_id, domain, level) DO NOTHING`,
        [lifeId, domain, level, xp, String(version)],
      );
    },
  };
}
