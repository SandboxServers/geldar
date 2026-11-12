import { describe, expect, it } from 'vitest';
import { bearingOf, HurtReporter, hurtEvent, sourceOf } from './hurt.ts';

const HERE = { x: 0, z: 0 };

describe('sourceOf: each cause maps to its source', () => {
  it.each([
    ['ENTITY_ATTACK', 'melee'],
    ['ENTITY_SWEEP_ATTACK', 'melee'],
    ['PROJECTILE', 'arrow'],
    ['ENTITY_EXPLOSION', 'explosion'],
    ['BLOCK_EXPLOSION', 'explosion'],
    ['FALL', 'fall'],
    ['FIRE', 'fire'],
    ['FIRE_TICK', 'fire'],
    ['LAVA', 'lava'],
    ['DROWNING', 'drowning'],
    ['STARVATION', 'starvation'],
  ])('%s is %s', (cause, source) => {
    expect(sourceOf(cause)).toBe(source);
  });

  it('maps an unknown or missing cause to other', () => {
    expect(sourceOf('LIGHTNING')).toBe('other');
    expect(sourceOf('constructor')).toBe('other');
    expect(sourceOf(undefined)).toBe('other');
  });
});

describe('bearingOf: relative to the facing, on every axis and sign', () => {
  // Minecraft yaw 0 faces +z, 90 degrees faces -x, -90 faces +x, 180 faces -z. The right hand is
  // the facing turned a quarter turn clockwise seen from above. The yaw is passed in radians.
  const deg = (d: number): number => (d * Math.PI) / 180;
  const cases: Array<[number, Record<'+x' | '-x' | '+z' | '-z', string>]> = [
    [deg(0), { '+z': 'front', '-z': 'behind', '-x': 'right', '+x': 'left' }],
    [deg(90), { '-x': 'front', '+x': 'behind', '-z': 'right', '+z': 'left' }],
    [deg(-90), { '+x': 'front', '-x': 'behind', '+z': 'right', '-z': 'left' }],
    [deg(180), { '-z': 'front', '+z': 'behind', '+x': 'right', '-x': 'left' }],
  ];
  const offsets = {
    '+x': { x: 1, z: 0 },
    '-x': { x: -1, z: 0 },
    '+z': { x: 0, z: 1 },
    '-z': { x: 0, z: -1 },
  } as const;

  for (const [yaw, expected] of cases) {
    for (const axis of ['+x', '-x', '+z', '-z'] as const) {
      it(`yaw ${yaw}: attacker at ${axis} is ${expected[axis]}`, () => {
        expect(bearingOf({ ...HERE, yaw }, offsets[axis])).toBe(expected[axis]);
      });
    }
  }

  it('reads the bearing from the Body position, not the origin', () => {
    expect(bearingOf({ x: 10, z: 10, yaw: 0 }, { x: 10, z: 14 })).toBe('front');
  });
});

describe('hurtEvent: duplicates, rounding, cap and missing attacker', () => {
  it('emits nothing for a zero amount', () => {
    expect(
      hurtEvent({
        cause: 'FALL',
        attacker: null,
        self: { ...HERE, yaw: 0 },
        healthBefore: 10,
        rawDamage: 0.2,
      }),
    ).toBeNull();
    expect(
      hurtEvent({
        cause: 'FALL',
        attacker: null,
        self: { ...HERE, yaw: 0 },
        healthBefore: 10,
        rawDamage: 0,
      }),
    ).toBeNull();
  });

  it('emits nothing for a damage that is not a number', () => {
    expect(
      hurtEvent({
        cause: 'FALL',
        attacker: null,
        self: { ...HERE, yaw: 0 },
        healthBefore: 10,
        rawDamage: Number.NaN,
      }),
    ).toBeNull();
  });

  it('caps the amount at the health left: 19.7 at 4 health is 4, not 20', () => {
    const hurt = hurtEvent({
      cause: 'ENTITY_ATTACK',
      attacker: { x: 0, z: 1 },
      self: { ...HERE, yaw: 0 },
      healthBefore: 4,
      rawDamage: 19.7,
    });
    expect(hurt?.amount).toBe(4);
  });

  it('rounds the amount: 2.6 at 10 health is 3', () => {
    const hurt = hurtEvent({
      cause: 'FALL',
      attacker: null,
      self: { ...HERE, yaw: 0 },
      healthBefore: 10,
      rawDamage: 2.6,
    });
    expect(hurt).toEqual({ type: 'hurt', source: 'fall', amount: 3 });
  });

  it('gives source other with no bearing and no throw when an arrow has no known attacker', () => {
    const hurt = hurtEvent({
      cause: 'PROJECTILE',
      attacker: null,
      self: { ...HERE, yaw: 0 },
      healthBefore: 9,
      rawDamage: 3,
    });
    expect(hurt).toEqual({ type: 'hurt', source: 'other', amount: 3 });
    expect(hurt).not.toHaveProperty('bearing');
  });

  it('keeps a fall with no attacker as fall, with no bearing', () => {
    const hurt = hurtEvent({
      cause: 'FALL',
      attacker: null,
      self: { ...HERE, yaw: 0 },
      healthBefore: 9,
      rawDamage: 3,
    });
    expect(hurt).toEqual({ type: 'hurt', source: 'fall', amount: 3 });
  });

  it('carries a bearing for an attacker that is known, and no coordinates', () => {
    const hurt = hurtEvent({
      cause: 'PROJECTILE',
      attacker: { x: 0, z: -5 },
      self: { ...HERE, yaw: 0 },
      healthBefore: 14,
      rawDamage: 3,
    });
    expect(hurt).toEqual({ type: 'hurt', source: 'arrow', bearing: 'behind', amount: 3 });
    expect(Object.keys(hurt ?? {}).sort()).toEqual(['amount', 'bearing', 'source', 'type']);
  });
});

describe('HurtReporter: close and error paths', () => {
  it('passes a hurt on while open and returns it', () => {
    const seen: Array<[string, number]> = [];
    const reporter = new HurtReporter((hurt, tick) => seen.push([hurt.source, tick]));
    const hurt = reporter.report(
      { cause: 'FALL', attacker: null, self: { ...HERE, yaw: 0 }, healthBefore: 10, rawDamage: 4 },
      7,
    );
    expect(hurt?.amount).toBe(4);
    expect(seen).toEqual([['fall', 7]]);
  });

  it('does not pass on a zero-amount hurt', () => {
    const seen: unknown[] = [];
    const reporter = new HurtReporter((hurt) => seen.push(hurt));
    expect(
      reporter.report(
        {
          cause: 'FALL',
          attacker: null,
          self: { ...HERE, yaw: 0 },
          healthBefore: 10,
          rawDamage: 0,
        },
        1,
      ),
    ).toBeNull();
    expect(seen).toEqual([]);
  });

  it('drops a hurt after close (the bot ended): no event, no sink call', () => {
    const seen: unknown[] = [];
    const reporter = new HurtReporter((hurt) => seen.push(hurt));
    reporter.close();
    const hurt = reporter.report(
      { cause: 'FALL', attacker: null, self: { ...HERE, yaw: 0 }, healthBefore: 10, rawDamage: 4 },
      9,
    );
    expect(hurt).toBeNull();
    expect(seen).toEqual([]);
  });
});
