// The XP ledger (card AN-10a). applyAward runs inside the writer's transaction: the evidence row first, and
// the increment only when that row was new, so a redelivered or second-source accomplishment adds nothing.
import { type Domain, levelForXp } from '@geldar/psyche';
import type { XpAward } from './awards.ts';

export interface XpStore {
  lifeExists(lifeId: string): Promise<boolean>;
  insertEvidence(a: XpAward): Promise<boolean>; // INSERT ... ON CONFLICT (life_id, domain, evidence_key) DO NOTHING RETURNING 1
  bump(lifeId: string, domain: Domain, tick: number): Promise<{ xp: number }>; // INSERT ... ON CONFLICT (life_id, domain) DO UPDATE SET xp = proficiency.xp + 1, updated_tick = GREATEST(...) RETURNING xp
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
  const { xp } = await store.bump(award.lifeId, award.domain, award.worldTick);
  const level = levelForXp(xp, thresholds);
  const rose = level > levelForXp(xp - 1, thresholds);
  if (level === 0 || !rose) return { awarded: true, level: null };
  await store.setLevel(award.lifeId, award.domain, level);
  const version = await store.totalXp(award.lifeId);
  await store.enqueueLevel(award.lifeId, award.domain, level, xp, version);
  return { awarded: true, level };
}
