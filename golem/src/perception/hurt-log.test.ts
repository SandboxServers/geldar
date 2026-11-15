import { describe, expect, it } from 'vitest';
import type { Place } from '../body/where.ts';
import { hurtLogLine } from './hurt-log.ts';

const overworld: Place = { x: 1.2, y: 70, z: -3.4, dimension: 'minecraft:overworld' };

describe('hurtLogLine: one hurt, one log line with where the Body stood', () => {
  it('a melee hit from in front carries its bearing and the place', () => {
    const line = hurtLogLine(
      { type: 'hurt', source: 'melee', bearing: 'front', amount: 4 },
      overworld,
      77,
    );
    expect(JSON.parse(line)).toEqual({
      event: 'hurt',
      world_tick: 77,
      source: 'melee',
      amount: 4,
      bearing: 'front',
      x: 1.2,
      y: 70,
      z: -3.4,
      dimension: 'minecraft:overworld',
    });
  });

  it('a hit with no bearing gives bearing null, and an unknown place gives null fields', () => {
    const none: Place = { x: null, y: null, z: null, dimension: null };
    const line = hurtLogLine({ type: 'hurt', source: 'fall', amount: 2 }, none, 9);
    expect(JSON.parse(line)).toMatchObject({
      event: 'hurt',
      source: 'fall',
      amount: 2,
      bearing: null,
      x: null,
      dimension: null,
    });
  });

  it('a hit from behind keeps the negative coordinates as they are', () => {
    const place: Place = { x: -250.5, y: 12, z: -0.1, dimension: 'minecraft:the_nether' };
    const parsed = JSON.parse(hurtLogLine({ type: 'hurt', source: 'other', amount: 3 }, place, 1));
    expect(parsed).toMatchObject({ x: -250.5, y: 12, z: -0.1, dimension: 'minecraft:the_nether' });
  });
});
