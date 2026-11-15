import { describe, expect, it } from 'vitest';
import { placeFields } from './where.ts';

describe('placeFields: where the Body is in a log line', () => {
  it('rounds each axis to one decimal, positive and negative', () => {
    expect(placeFields({ x: 12.34, y: 64.96, z: -133.27 }, 'minecraft:overworld')).toEqual({
      x: 12.3,
      y: 65,
      z: -133.3,
      dimension: 'minecraft:overworld',
    });
  });

  it('keeps the sign on the negative x and z axes', () => {
    const place = placeFields({ x: -4.44, y: 70, z: -0.26 }, 'minecraft:the_nether');
    expect(place.x).toBe(-4.4);
    expect(place.z).toBe(-0.3);
  });

  it('gives null for a position that is not known, and still returns the dimension', () => {
    expect(placeFields(undefined, 'minecraft:overworld')).toEqual({
      x: null,
      y: null,
      z: null,
      dimension: 'minecraft:overworld',
    });
  });

  it('gives null for a dimension that is not known', () => {
    expect(placeFields({ x: 1, y: 2, z: 3 }, undefined)).toEqual({
      x: 1,
      y: 2,
      z: 3,
      dimension: null,
    });
  });
});
