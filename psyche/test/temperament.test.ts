import { markedWords } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import {
  type CharacterSheet,
  type Score,
  STANDARD_SHEET,
  TEMPERAMENT_BANK,
  temperamentFor,
} from '../src/index.ts';

type Field = 'curiosity' | 'common_sense' | 'cleverness' | 'aggression' | 'law' | 'good';

// The owner's brief 5.9, copied verbatim. The test keeps its own copy, so a changed bank
// sentence fails here as well as in the bank.
type Shown = 1 | 2 | 4 | 5;

const BRIEF_5_9: Record<Field, Record<Shown, string>> = {
  curiosity: {
    '1': 'You have little interest in the unknown.',
    '2': 'You keep mostly to what you know.',
    '4': 'New places and things pull at you.',
    '5': 'You cannot leave a mystery alone.',
  },
  common_sense: {
    '1': 'You often act before you think.',
    '2': 'You sometimes miss the obvious.',
    '4': 'You are practical and level-headed.',
    '5': 'Little gets past your good sense.',
  },
  cleverness: {
    '1': 'New ideas come to you slowly.',
    '2': 'You prefer the tried way.',
    '4': 'You often see another way to do things.',
    '5': 'You are full of new ideas.',
  },
  aggression: {
    '1': 'You avoid any fight you can.',
    '2': 'You would rather run than fight.',
    '4': 'You stand your ground.',
    '5': 'You meet trouble head on.',
  },
  law: {
    '1': "You follow no one's rules but your own.",
    '2': 'Rules bend when they get in your way.',
    '4': "You keep your word and respect what is others'.",
    '5': 'Your word is iron and you honour every agreement.',
  },
  good: {
    '1': 'You look after yourself, whoever pays.',
    '2': 'You put yourself first.',
    '4': 'You help others when you can.',
    '5': 'You give freely, even at a cost to yourself.',
  },
};

const FIELDS: readonly Field[] = [
  'curiosity',
  'common_sense',
  'cleverness',
  'aggression',
  'law',
  'good',
];
const NON_STANDARD: readonly Shown[] = [1, 2, 4, 5];

function sheetWith(scores: Partial<Record<Field, Score>>): CharacterSheet {
  const s = (field: Field): Score => scores[field] ?? 3;
  return {
    ...STANDARD_SHEET,
    attributes: {
      curiosity: s('curiosity'),
      common_sense: s('common_sense'),
      cleverness: s('cleverness'),
      aggression: s('aggression'),
    },
    alignment: { law: s('law'), good: s('good') },
  };
}

// The sentences the bank actually holds. The marker and digit scans read these, not the copy.
function bankSentences(): string[] {
  return FIELDS.flatMap((field) => NON_STANDARD.map((score) => TEMPERAMENT_BANK[field][score]));
}

function allSentences(): string[] {
  return FIELDS.flatMap((field) => NON_STANDARD.map((score) => BRIEF_5_9[field][score]));
}

describe('temperamentFor', () => {
  it('gives no sentences for the standard sheet (every score is 3)', () => {
    expect(temperamentFor(STANDARD_SHEET)).toEqual([]);
  });

  it('gives the exact brief sentence for each field at each non-3 score', () => {
    for (const field of FIELDS) {
      for (const score of NON_STANDARD) {
        const expected = BRIEF_5_9[field][score];
        expect(temperamentFor(sheetWith({ [field]: score })), `${field} ${score}`).toEqual([
          expected,
        ]);
      }
    }
  });

  it('gives sentences in the fixed order curiosity, common_sense, cleverness, aggression, law, good', () => {
    const sheet = sheetWith({
      good: 1,
      law: 2,
      aggression: 4,
      cleverness: 5,
      common_sense: 1,
      curiosity: 2,
    });
    expect(temperamentFor(sheet)).toEqual([
      BRIEF_5_9.curiosity['2'],
      BRIEF_5_9.common_sense['1'],
      BRIEF_5_9.cleverness['5'],
      BRIEF_5_9.aggression['4'],
      BRIEF_5_9.law['2'],
      BRIEF_5_9.good['1'],
    ]);
  });

  it('ignores the key order of the sheet object', () => {
    const reversed: CharacterSheet = {
      ...STANDARD_SHEET,
      attributes: { aggression: 5, cleverness: 1, common_sense: 2, curiosity: 4 },
      alignment: { good: 4, law: 1 },
    };
    expect(temperamentFor(reversed)).toEqual([
      BRIEF_5_9.curiosity['4'],
      BRIEF_5_9.common_sense['2'],
      BRIEF_5_9.cleverness['1'],
      BRIEF_5_9.aggression['5'],
      BRIEF_5_9.law['1'],
      BRIEF_5_9.good['4'],
    ]);
  });

  it('gives one sentence per non-3 field and none for a 3, in a mixed sheet', () => {
    const sheet = sheetWith({ curiosity: 3, cleverness: 4, law: 3, good: 5 });
    expect(temperamentFor(sheet)).toEqual([BRIEF_5_9.cleverness['4'], BRIEF_5_9.good['5']]);
  });
});

describe('TEMPERAMENT_BANK', () => {
  it('holds exactly the brief 5.9 sentences: 6 fields by scores 1, 2, 4 and 5', () => {
    expect(Object.keys(TEMPERAMENT_BANK).sort()).toEqual([...FIELDS].sort());
    for (const field of FIELDS) {
      expect(Object.keys(TEMPERAMENT_BANK[field]).sort()).toEqual(['1', '2', '4', '5']);
      for (const score of NON_STANDARD) {
        expect(TEMPERAMENT_BANK[field][score], `${field} ${score}`).toBe(BRIEF_5_9[field][score]);
      }
    }
    expect(allSentences()).toHaveLength(24);
  });

  it('keeps the longest sentence of each field, summed, within the 245-character budget', () => {
    const longestPerField = FIELDS.map((field) =>
      Math.max(...NON_STANDARD.map((score) => TEMPERAMENT_BANK[field][score].length)),
    );
    const total = longestPerField.reduce((sum, length) => sum + length, 0);
    expect(total).toBeLessThanOrEqual(245);
  });

  it('contains no marker word, by the shared markedWords list', () => {
    for (const sentence of bankSentences()) {
      expect(markedWords(sentence), sentence).toEqual([]);
    }
  });

  it('contains no marker word, by a local whole-word scan', () => {
    const marker = /\b(observer|watch|human|maker|stream|credit|colo|shard|harness)\b/i;
    for (const sentence of bankSentences()) {
      expect(marker.test(sentence), sentence).toBe(false);
    }
  });

  it('has no digits and no D&D labels (alignment letters, score, stat)', () => {
    const digits = /\d/;
    const alignmentLetters = /\b[LCTNGE]{1,2}\b/;
    const labels = /\b(lawful|chaotic|neutral|evil|alignment|score|stat)\b/i;
    for (const sentence of bankSentences()) {
      expect(digits.test(sentence), sentence).toBe(false);
      expect(alignmentLetters.test(sentence), sentence).toBe(false);
      expect(labels.test(sentence), sentence).toBe(false);
    }
  });
});
