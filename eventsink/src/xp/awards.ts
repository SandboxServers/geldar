// Interface scaffold from AN-S0. Owned by AN-09a; replace the body, keep the exported signatures unless the card owner records a change in the worknote.
import type { WorldEvent } from '@geldar/contract';
import type { Domain } from '@geldar/psyche';

export interface XpAward {
  lifeId: string;
  domain: Domain;
  evidenceKey: string;
  sourceEventId: string;
  worldTick: number;
}

// pure, never throws, [] for anything else
export function awardsFor(event: WorldEvent): XpAward[] {
  throw new Error('AN-09a not implemented');
}
