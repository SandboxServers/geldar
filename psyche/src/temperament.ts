// Inactive data. Wording supplied by the owner's brief 5.9; not read by any agent until the owner approves the delivery route (decisions 0058/0059/0068).

import type { CharacterSheet, Score } from './types.ts';

export type TemperamentField =
  | 'curiosity'
  | 'common_sense'
  | 'cleverness'
  | 'aggression'
  | 'law'
  | 'good';

export type TemperamentScore = 1 | 2 | 4 | 5;

// The fixed output order. A score of 3 gives no sentence.
const ORDER: readonly TemperamentField[] = [
  'curiosity',
  'common_sense',
  'cleverness',
  'aggression',
  'law',
  'good',
];

export const TEMPERAMENT_BANK: Readonly<
  Record<TemperamentField, Readonly<Record<TemperamentScore, string>>>
> = {
  curiosity: {
    1: 'You have little interest in the unknown.',
    2: 'You keep mostly to what you know.',
    4: 'New places and things pull at you.',
    5: 'You cannot leave a mystery alone.',
  },
  common_sense: {
    1: 'You often act before you think.',
    2: 'You sometimes miss the obvious.',
    4: 'You are practical and level-headed.',
    5: 'Little gets past your good sense.',
  },
  cleverness: {
    1: 'New ideas come to you slowly.',
    2: 'You prefer the tried way.',
    4: 'You often see another way to do things.',
    5: 'You are full of new ideas.',
  },
  aggression: {
    1: 'You avoid any fight you can.',
    2: 'You would rather run than fight.',
    4: 'You stand your ground.',
    5: 'You meet trouble head on.',
  },
  law: {
    1: "You follow no one's rules but your own.",
    2: 'Rules bend when they get in your way.',
    4: "You keep your word and respect what is others'.",
    5: 'Your word is iron and you honour every agreement.',
  },
  good: {
    1: 'You look after yourself, whoever pays.',
    2: 'You put yourself first.',
    4: 'You help others when you can.',
    5: 'You give freely, even at a cost to yourself.',
  },
};

function scoreOf(sheet: CharacterSheet, field: TemperamentField): Score {
  switch (field) {
    case 'curiosity':
    case 'common_sense':
    case 'cleverness':
    case 'aggression':
      return sheet.attributes[field];
    case 'law':
    case 'good':
      return sheet.alignment[field];
  }
}

// One sentence per field whose score is not 3, in the fixed order. A standard sheet gives [].
export function temperamentFor(sheet: CharacterSheet): string[] {
  const sentences: string[] = [];
  for (const field of ORDER) {
    const score = scoreOf(sheet, field);
    if (score !== 3) sentences.push(TEMPERAMENT_BANK[field][score]);
  }
  return sentences;
}
