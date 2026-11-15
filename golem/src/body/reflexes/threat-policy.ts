// Interface scaffold from AN-S0. Owned by AN-08b; replace the body, keep the exported signatures unless the card owner records a change in the worknote.
// No psyche import: AN-08b's deliver block types the decision roll as unknown, and no psyche type is needed here.

export interface ThreatPolicy {
  floor(): number;
  fightLimitMs(): number;
  decide(input: { health: number; armed: boolean; suicideMob: boolean }): {
    action: 'fight' | 'flee';
    why: string;
    roll: unknown | null;
  };
}

// floor 6, 30000 ms, fight iff armed && health > 6: today's behaviour
export declare const LEGACY_THREAT: ThreatPolicy;
