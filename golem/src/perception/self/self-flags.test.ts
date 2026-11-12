import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { selfFlags } from './self-flags.ts';

interface FakeOpts {
  /** Inventory items by slot index (5 helmet, 6 chestplate, 7 leggings, 8 boots, 36 hotbar). */
  slots?: Record<number, string>;
  onGround?: boolean;
  isInWater?: boolean;
  velocityY?: number;
  /** Entity flags metadata; bit 0 is on fire. */
  flags?: number;
  oxygen?: number | undefined;
  /** Water in the block at the feet (y 64) or at the eye (y 65, floor of 64 + 1.62). */
  feetWater?: boolean;
  headWater?: boolean;
  noEntity?: boolean;
}

function fakeBot(o: FakeOpts = {}): Bot {
  const slots = Array.from({ length: 46 }, (_, i) =>
    o.slots?.[i] === undefined ? null : { name: o.slots[i] },
  );
  return {
    entity: o.noEntity
      ? undefined
      : {
          position: new Vec3(0.5, 64, 0.5),
          onGround: o.onGround ?? true,
          isInWater: o.isInWater ?? false,
          velocity: new Vec3(0, o.velocityY ?? 0, 0),
          metadata: [o.flags ?? 0],
        },
    inventory: { slots },
    oxygenLevel: o.oxygen,
    blockAt: (at: Vec3) => {
      const water =
        (Math.floor(at.y) === 64 && o.feetWater === true) ||
        (Math.floor(at.y) === 65 && o.headWater === true);
      return water ? { name: 'water' } : null;
    },
  } as unknown as Bot;
}

describe('selfFlags: armour', () => {
  it('is 0 with nothing worn', () => {
    expect(selfFlags(fakeBot()).armor).toBe(0);
  });

  it('counts an iron chestplate in the chest slot as 6, not 0', () => {
    expect(selfFlags(fakeBot({ slots: { 6: 'iron_chestplate' } })).armor).toBe(6);
  });

  it('does not count armour carried in the hotbar or main inventory', () => {
    expect(selfFlags(fakeBot({ slots: { 36: 'iron_chestplate' } })).armor).toBe(0);
  });

  it('adds every worn piece: full diamond is 20, turtle helmet 2, leather boots 1', () => {
    const full = {
      5: 'diamond_helmet',
      6: 'diamond_chestplate',
      7: 'diamond_leggings',
      8: 'diamond_boots',
    };
    expect(selfFlags(fakeBot({ slots: full })).armor).toBe(20);
    expect(selfFlags(fakeBot({ slots: { 5: 'turtle_helmet' } })).armor).toBe(2);
    expect(selfFlags(fakeBot({ slots: { 8: 'leather_boots' } })).armor).toBe(1);
  });
});

describe('selfFlags: status flags', () => {
  it('lists only on_ground when standing still', () => {
    expect(selfFlags(fakeBot()).status_flags).toEqual(['on_ground']);
  });

  it('omits the key when no flag is true', () => {
    expect(selfFlags(fakeBot({ onGround: false }))).not.toHaveProperty('status_flags');
  });

  it('shows burning only from entity flag bit 0', () => {
    expect(selfFlags(fakeBot({ flags: 1 })).status_flags).toEqual(['burning', 'on_ground']);
    expect(selfFlags(fakeBot({ flags: 2 })).status_flags).toEqual(['on_ground']);
  });

  it('shows in_water from the entity flag, and underwater only when the eye block is water', () => {
    expect(selfFlags(fakeBot({ isInWater: true, onGround: false })).status_flags).toEqual([
      'in_water',
    ]);
    // Water at the feet only: the head is above it, so not underwater (y axis).
    const feetOnly = selfFlags(fakeBot({ feetWater: true, onGround: false })).status_flags ?? [];
    expect(feetOnly).not.toContain('underwater');
    const headIn = selfFlags(fakeBot({ headWater: true, onGround: false })).status_flags ?? [];
    expect(headIn).toContain('underwater');
  });

  it('shows falling only while airborne and moving down', () => {
    expect(selfFlags(fakeBot({ onGround: false, velocityY: -0.5 })).status_flags).toEqual([
      'falling',
    ]);
    expect(selfFlags(fakeBot({ onGround: false, velocityY: 0.5 })).status_flags).toBeUndefined();
    expect(selfFlags(fakeBot({ onGround: true, velocityY: -0.08 })).status_flags).toEqual([
      'on_ground',
    ]);
  });

  it('lists flags in the fixed schema order', () => {
    const flags = selfFlags(
      fakeBot({ flags: 1, headWater: true, onGround: false, velocityY: -1, isInWater: true }),
    ).status_flags;
    expect(flags).toEqual(['burning', 'underwater', 'falling', 'in_water']);
  });

  it('gives no flags and does not throw when the entity is not spawned', () => {
    const result = selfFlags(fakeBot({ noEntity: true }));
    expect(result).toEqual({ armor: 0 });
  });
});

describe('selfFlags: air', () => {
  it('omits air at 20 (full breath)', () => {
    expect(selfFlags(fakeBot({ oxygen: 20 }))).not.toHaveProperty('air');
  });

  it('shows air at 19', () => {
    expect(selfFlags(fakeBot({ oxygen: 19 })).air).toBe(19);
  });

  it('shows 0 and omits the key when the level is unknown', () => {
    expect(selfFlags(fakeBot({ oxygen: 0 })).air).toBe(0);
    expect(selfFlags(fakeBot({ oxygen: undefined }))).not.toHaveProperty('air');
  });
});
