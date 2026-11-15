// The XP ledger (card AN-10a). applyAward runs inside the writer's transaction: the evidence row first, and
// the increment only when that row was new, so a redelivered or second-source accomplishment adds nothing.
import { type Domain, levelForXp } from '@geldar/psyche';
import type { XpAward } from './awards.ts';

export interface XpStore {
  lifeExists(lifeId: string): Promise<boolean>;
  insertEvidence(a: XpAward): Promise<boolean>; // INSERT ... ON CONFLICT (life_id, domain, evidence_key) DO NOTHING RETURNING 1
  // INSERT ... ON CONFLICT (life_id, domain) DO UPDATE SET xp = proficiency.xp + 1, updated_tick = GREATEST(...)
  // RETURNING xp, level. `level` is the stored level under the row lock: the UPDATE does not change it, so it is
  // the level before this award (0 for a new row).
  bump(lifeId: string, domain: Domain, tick: number): Promise<{ xp: number; level: number }>;
  setLevel(lifeId: string, domain: Domain, level: 1 | 2 | 3): Promise<void>;
  totalXp(lifeId: string): Promise<number>;
  enqueueLevel(
    lifeId: string,
    domain: Domain,
    level: 1 | 2 | 3,
    xp: number,
    version: number,
  ): Promise<void>; // INSERT ... ON CONFLICT (life_id, domain, level) DO NOTHING
}

export type XpLog = (line: string) => void;

const logWarn: XpLog = (line) => console.warn(line);

/**
 * Applies one award. Returns `awarded` (the evidence row was new) and the new `level` when this award
 * crossed a threshold, else null. An unknown life is logged as `xp_skipped_unknown_life` and skipped;
 * a store error rejects, so the writer's transaction rolls back.
 */
export async function applyAward(
  store: XpStore,
  award: XpAward,
  thresholds: readonly [number, number, number],
  log: XpLog = logWarn,
): Promise<{ awarded: boolean; level: number | null }> {
  if (!(await store.lifeExists(award.lifeId))) {
    log(
      `xp_skipped_unknown_life life=${award.lifeId} domain=${award.domain} evidence=${award.evidenceKey}`,
    );
    return { awarded: false, level: null };
  }
  if (!(await store.insertEvidence(award))) return { awarded: false, level: null };
  const { xp, level: stored } = await store.bump(award.lifeId, award.domain, award.worldTick);
  const level = levelForXp(xp, thresholds);
  // The level rose when the threshold level is above the stored one. Tied thresholds can cross two levels at
  // once: only the highest is stored and enqueued.
  if (level === 0 || level <= stored) return { awarded: true, level: null };
  await store.setLevel(award.lifeId, award.domain, level);
  const version = await store.totalXp(award.lifeId);
  await store.enqueueLevel(award.lifeId, award.domain, level, xp, version);
  return { awarded: true, level };
}
