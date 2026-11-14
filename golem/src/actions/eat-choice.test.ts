import { describe, expect, it } from 'vitest';
import {
  CHICKEN_REFUSAL,
  chooseFood,
  edibleAtHunger,
  type FoodInfo,
  LAST_RESORT_REFUSAL,
} from './eat-choice.ts';

/** Food numbers for the fake registry (decision 0216). `milk_bucket` and the banned foods have entries on purpose. */
const FOODS: Record<string, FoodInfo> = {
  porkchop: { foodPoints: 3, saturation: 1.8 },
  cooked_beef: { foodPoints: 8, saturation: 12.8 },
  bread: { foodPoints: 5, saturation: 6 },
  apple: { foodPoints: 4, saturation: 2.4 },
  rotten_flesh: { foodPoints: 4, saturation: 0.8 },
  chicken: { foodPoints: 2, saturation: 1.2 },
  golden_apple: { foodPoints: 4, saturation: 9.6 },
  golden_carrot: { foodPoints: 6, saturation: 14.4 },
  chorus_fruit: { foodPoints: 4, saturation: 2.4 },
  spider_eye: { foodPoints: 2, saturation: 3.2 },
  poisonous_potato: { foodPoints: 2, saturation: 1.2 },
  pufferfish: { foodPoints: 1, saturation: 0.2 },
  suspicious_stew: { foodPoints: 6, saturation: 7.2 },
  milk_bucket: { foodPoints: 3, saturation: 0 },
  water_bucket: { foodPoints: 3, saturation: 0 },
};

describe('chooseFood: fit to the missing hunger', () => {
  it('picks the food that fits the missing hunger: porkchop (3) for 3 missing', () => {
    expect(chooseFood(['porkchop', 'cooked_beef'], FOODS, 17)).toEqual({
      kind: 'eat',
      name: 'porkchop',
    });
  });

  it('picks the largest food that fits: cooked_beef (8) for 10 missing', () => {
    expect(chooseFood(['porkchop', 'cooked_beef'], FOODS, 10)).toEqual({
      kind: 'eat',
      name: 'cooked_beef',
    });
  });

  it('with nothing that fits, picks the smallest overshoot: porkchop (3) for 1 missing', () => {
    expect(chooseFood(['cooked_beef', 'porkchop'], FOODS, 19)).toEqual({
      kind: 'eat',
      name: 'porkchop',
    });
  });

  it('breaks a tie on food points by lower saturation, then by name', () => {
    const foods = {
      pumpkin_pie: { foodPoints: 5, saturation: 4.8 },
      bread: { foodPoints: 5, saturation: 6 },
      beetroot: { foodPoints: 4, saturation: 2.4 },
      apple: { foodPoints: 4, saturation: 2.4 },
    };
    expect(chooseFood(['bread', 'pumpkin_pie'], foods, 10)).toMatchObject({ name: 'pumpkin_pie' });
    expect(chooseFood(['beetroot', 'apple'], foods, 10)).toMatchObject({ name: 'apple' });
    // Overshoot tie (missing 1): lower saturation wins too.
    expect(chooseFood(['bread', 'pumpkin_pie'], foods, 19)).toMatchObject({ name: 'pumpkin_pie' });
  });

  it('ignores names with no food entry', () => {
    expect(chooseFood(['stone', 'apple'], FOODS, 10)).toMatchObject({ name: 'apple' });
    expect(chooseFood(['stone'], FOODS, 10)).toEqual({ kind: 'none' });
  });
});

describe('chooseFood: banned foods', () => {
  it.each([
    ['poisonous_potato'],
    ['milk_bucket'],
    ['water_bucket'],
    ['spider_eye'],
    ['chorus_fruit'],
    ['pufferfish'],
    ['suspicious_stew'],
  ])('never picks %s, alone or as the only food', (name) => {
    expect(chooseFood([name], FOODS, 10)).toEqual({ kind: 'none' });
    expect(chooseFood([name], FOODS, 6)).toEqual({ kind: 'none' });
  });

  it('keeps a banned food out even when it has the most food points', () => {
    expect(chooseFood(['chorus_fruit', 'bread'], FOODS, 10)).toMatchObject({ name: 'bread' });
  });
});

describe('chooseFood: rotten flesh as a last resort (decision 0168)', () => {
  it('never picks rotten flesh while other food is carried', () => {
    expect(chooseFood(['rotten_flesh', 'apple'], FOODS, 6)).toMatchObject({ name: 'apple' });
    expect(chooseFood(['rotten_flesh', 'porkchop'], FOODS, 3)).toMatchObject({ name: 'porkchop' });
  });

  it('eats rotten flesh when it is the only food and hunger is 6', () => {
    expect(chooseFood(['rotten_flesh'], FOODS, 6)).toEqual({ kind: 'eat', name: 'rotten_flesh' });
  });

  it('refuses rotten flesh as the only food when hunger is 7', () => {
    expect(chooseFood(['rotten_flesh'], FOODS, 7)).toEqual({
      kind: 'refuse',
      message: LAST_RESORT_REFUSAL,
    });
  });
});

describe('chooseFood: raw chicken as a last resort', () => {
  it('is never picked while other ordinary food is carried', () => {
    expect(chooseFood(['chicken', 'apple'], FOODS, 6)).toMatchObject({ name: 'apple' });
  });

  it('is eaten when it is the only food and hunger is 6 or below', () => {
    expect(chooseFood(['chicken'], FOODS, 6)).toEqual({ kind: 'eat', name: 'chicken' });
    expect(chooseFood(['chicken'], FOODS, 2)).toEqual({ kind: 'eat', name: 'chicken' });
  });

  it('is refused as the only food when hunger is 7', () => {
    expect(chooseFood(['chicken'], FOODS, 7)).toEqual({ kind: 'refuse', message: CHICKEN_REFUSAL });
  });
});

describe('chooseFood: golden items only when nothing else exists', () => {
  it('is never picked while an ordinary food is carried', () => {
    expect(chooseFood(['golden_apple', 'apple'], FOODS, 10)).toMatchObject({ name: 'apple' });
  });

  it('is eaten alone at any hunger below full', () => {
    expect(chooseFood(['golden_carrot'], FOODS, 19)).toEqual({
      kind: 'eat',
      name: 'golden_carrot',
    });
    expect(chooseFood(['golden_apple'], FOODS, 7)).toEqual({ kind: 'eat', name: 'golden_apple' });
  });

  it('beats rotten flesh (rotten flesh is eaten only as the sole food)', () => {
    expect(chooseFood(['rotten_flesh', 'golden_apple'], FOODS, 6)).toEqual({
      kind: 'eat',
      name: 'golden_apple',
    });
  });
});

describe('edibleAtHunger (the eat reflex gate)', () => {
  it('lists the ordinary foods at any hunger, and the last resorts only at 6 or below', () => {
    // Any non-banned name counts for the gate, as before 0216; the action then finds no food for it.
    expect(edibleAtHunger(['stone', 'apple'], 10)).toEqual(['stone', 'apple']);
    expect(edibleAtHunger(['milk_bucket', 'apple'], 10)).toEqual(['apple']);
    expect(edibleAtHunger(['rotten_flesh'], 6)).toEqual(['rotten_flesh']);
    expect(edibleAtHunger(['rotten_flesh'], 7)).toEqual([]);
    expect(edibleAtHunger(['chicken'], 7)).toEqual([]);
    expect(edibleAtHunger(['chicken'], 6)).toEqual(['chicken']);
  });
});
