import { describe, expect, it } from 'vitest';
import type { Place } from '../body/where.ts';
import { hurtEvent } from './hurt.ts';
import { hurtLogLine } from './hurt-log.ts';
import { attackerNameOf } from './hurt-trigger.ts';

const overworld: Place = { x: 1.2, y: 70, z: -3.4, dimension: 'minecraft:overworld' };

describe('hurtLogLine: the attacker field', () => {
  const ground: Place = { x: 0, y: 64, z: 0, dimension: 'minecraft:overworld' };
  const self = { x: 0, z: 0, yaw: 0 };

  it('names the entity that hit the Body', () => {
    const line = hurtLogLine(
      { type: 'hurt', source: 'melee', amount: 4, attacker: 'zombie' },
      ground,
      5,
    );
    expect(JSON.parse(line)).toMatchObject({ attacker: 'zombie', source: 'melee' });
  });

  it('omits the attacker field when the cause is unknown', () => {
    const line = hurtLogLine({ type: 'hurt', source: 'fall', amount: 2 }, ground, 5);
    expect(JSON.parse(line)).not.toHaveProperty('attacker');
  });

  it('carries the attacker name from the damage input into the event', () => {
    const hurt = hurtEvent({
      cause: 'ENTITY_ATTACK',
      attacker: { x: 1, z: 0 },
      self,
      healthBefore: 20,
      rawDamage: 3,
      attackerName: 'iron_golem',
    });
    expect(hurt).toMatchObject({ attacker: 'iron_golem', source: 'melee' });
    const unnamed = hurtEvent({
      cause: 'FALL',
      attacker: null,
      self,
      healthBefore: 20,
      rawDamage: 3,
    });
    expect(unnamed).not.toHaveProperty('attacker');
  });
});

describe('attackerNameOf: the cause entity as the log names it', () => {
  it('says player for a player, never the player name', () => {
    expect(attackerNameOf({ id: 3, type: 'player', name: 'some_player' }, 7)).toBe('player');
  });

  it('names a hostile mob by its entity name', () => {
    expect(attackerNameOf({ id: 4, type: 'hostile', name: 'skeleton' }, 7)).toBe('skeleton');
  });

  it('names an iron golem by its entity name', () => {
    expect(attackerNameOf({ id: 5, type: 'hostile', name: 'iron_golem' }, 7)).toBe('iron_golem');
  });

  it('gives undefined with no cause entity, for the Body itself, or with no name', () => {
    expect(attackerNameOf(null, 7)).toBeUndefined();
    expect(attackerNameOf({ id: 7, type: 'player', name: 'ag_self' }, 7)).toBeUndefined();
    expect(attackerNameOf({ id: 9, type: 'other' }, 7)).toBeUndefined();
  });
});

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
