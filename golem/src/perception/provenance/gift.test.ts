import { readFileSync } from 'node:fs';
import { validateProvenance } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import { type GiftContext, observeGift, type PickupProvenance } from './gift.ts';

const SELF = 'ag_capb_02';
const THROWER = 'ag_capa_01';

/** The Body's view: a thrower named `THROWER` is visible, anyone else is not. */
const resolveVisible = (name: string | undefined) =>
  name === THROWER ? { name: THROWER, life: THROWER } : null;

/** A pickup by the Body of four cobblestone thrown by `THROWER`, 40 ticks old, 2 blocks away. */
function toss(overrides: Partial<PickupProvenance> = {}): PickupProvenance {
  return {
    kind: 'pickup',
    world: 'world',
    picker: SELF,
    thrower: THROWER,
    item: 'cobblestone',
    count: 4,
    age_ticks: 40,
    distance: 2,
    tick: 1178,
    ...overrides,
  };
}

function ctxFor(
  seen = new Set<string>(),
  resolve: GiftContext['resolve'] = resolveVisible,
): GiftContext {
  return { selfName: SELF, bot: {} as Bot, seen, resolve };
}

describe('observeGift', () => {
  it('a visible giver within reach gives an attributed gift', () => {
    const got = observeGift(toss(), ctxFor());
    expect(got).toEqual({
      kind: 'gift_received',
      actor: { name: THROWER, life: THROWER },
      item: 'cobblestone',
      count: 4,
      key: 'gift:1178:ag_capa_01:cobblestone:4:0',
    });
  });

  it('an invisible giver gives an unattributed gift', () => {
    const got = observeGift(
      toss(),
      ctxFor(new Set(), () => null),
    );
    expect(got).not.toBeNull();
    expect(got).not.toHaveProperty('actor');
    // The key says `none` for a hidden thrower: the raw name never reaches it.
    expect(got?.key).toBe('gift:1178:none:cobblestone:4:0');
    expect(got?.key).not.toContain(THROWER);
  });

  it("a third party's pickup gives nothing", () => {
    expect(observeGift(toss({ picker: 'ag_other_09' }), ctxFor())).toBeNull();
  });

  it('an old drop (age over 100) is not a gift', () => {
    expect(observeGift(toss({ age_ticks: 101 }), ctxFor())).toBeNull();
    expect(observeGift(toss({ age_ticks: 100 }), ctxFor())).not.toBeNull();
  });

  it('a far visible thrower is loot', () => {
    expect(observeGift(toss({ distance: 6.5 }), ctxFor())).toBeNull();
    expect(observeGift(toss({ distance: null }), ctxFor())).toBeNull();
    expect(observeGift(toss({ distance: 6 }), ctxFor())).not.toBeNull();
  });

  it('two equal tosses in one tick get ordinals 0 and 1', () => {
    const seen = new Set<string>();
    expect(observeGift(toss(), ctxFor(seen))?.key).toBe('gift:1178:ag_capa_01:cobblestone:4:0');
    expect(observeGift(toss(), ctxFor(seen))?.key).toBe('gift:1178:ag_capa_01:cobblestone:4:1');
  });

  it('the captured real payload validates with validateProvenance and maps', () => {
    const path = new URL('./fixtures/pickup-real.json', import.meta.url);
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    expect(validateProvenance(parsed)).toBe(true);
    const msg = parsed as PickupProvenance;
    expect(observeGift(msg, ctxFor())).toEqual({
      kind: 'gift_received',
      actor: { name: THROWER, life: THROWER },
      item: 'cobblestone',
      count: 4,
      key: 'gift:1178:ag_capa_01:cobblestone:4:0',
    });
    expect(observeGift(msg, { ...ctxFor(), selfName: THROWER })).toBeNull();
  });

  it('hostile and malformed pickups give nothing', () => {
    const hostile: Array<Partial<PickupProvenance>> = [
      { distance: Number.NaN },
      { distance: Number.POSITIVE_INFINITY },
      { distance: -1 },
      { age_ticks: -1 },
      { age_ticks: 1.5 },
      { count: 0 },
      { count: 2305 },
      { count: 1.5 },
      { count: '4' as unknown as number },
      { item: 'Cobblestone' },
      { item: 'a'.repeat(65) },
      { item: '' },
      { thrower: '' },
      { thrower: 'ag capa 01' },
      { tick: -1 },
      { tick: 1.5 },
      { world: '' },
    ];
    for (const overrides of hostile) {
      expect(observeGift(toss(overrides), ctxFor()), JSON.stringify(overrides)).toBeNull();
    }
  });

  it("the Body's own toss, in any letter case, gives nothing", () => {
    expect(
      observeGift(
        toss({ thrower: 'AG_CAPB_02' }),
        ctxFor(new Set(), () => null),
      ),
    ).toBeNull();
    expect(
      observeGift(
        toss({ thrower: SELF }),
        ctxFor(new Set(), () => null),
      ),
    ).toBeNull();
  });

  it('a resolver that throws gives nothing', () => {
    const throwing = () => {
      throw new Error('registry down');
    };
    expect(observeGift(toss(), ctxFor(new Set(), throwing))).toBeNull();
  });

  it('a refused key takes no slot in seen', () => {
    const seen = new Set<string>();
    const long = toss({ tick: 1_000_000_000, count: 2304, item: 'a'.repeat(64) });
    const resolve = () => ({ name: 'Aaaaaaaaaaaaaaaa', life: THROWER });
    expect(observeGift(long, ctxFor(seen, resolve))).toBeNull();
    expect(seen.size).toBe(0);
  });

  it('seen keeps the 256 newest keys', () => {
    const seen = new Set<string>();
    for (let tick = 0; tick < 300; tick++) observeGift(toss({ tick }), ctxFor(seen));
    expect(seen.size).toBe(256);
    expect(seen.has('gift:0:ag_capa_01:cobblestone:4:0')).toBe(false);
    expect(seen.has('gift:299:ag_capa_01:cobblestone:4:0')).toBe(true);
  });
});
