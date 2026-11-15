// Interface scaffold from AN-S0. Owned by AN-10a; replace the body, keep the exported signatures unless the card owner records a change in the worknote.
import type { Domain } from '@geldar/psyche';
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

export async function applyAward(
  store: XpStore,
  award: XpAward,
  thresholds: readonly [number, number, number],
): Promise<{ awarded: boolean; level: number | null }> {
  throw new Error('AN-10a not implemented');
}
