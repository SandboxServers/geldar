// The innate character sheet's shapes (decision 0186, D-CS-03). Types only: no runtime code, no imports.
// Proficiency is not here: XP lives in the proficiency state, so a sheet never carries it.

export type Score = 1 | 2 | 3 | 4 | 5;

export type Domain =
  | 'combat'
  | 'farming'
  | 'mining'
  | 'building'
  | 'crafting'
  | 'exploring'
  | 'social';

export interface CharacterSheet {
  version: 1;
  attributes: { curiosity: Score; common_sense: Score; cleverness: Score; aggression: Score };
  alignment: { law: Score; good: Score };
  op_modes: {
    explorer: Score;
    farmer: Score;
    miner: Score;
    builder: Score;
    crafter: Score;
    warrior: Score;
    nitwit: Score;
  };
}

export type SheetResult = { ok: true; sheet: CharacterSheet } | { ok: false; errors: string[] };
