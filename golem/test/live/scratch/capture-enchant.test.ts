// CAP-5: the enchanting-table offers are read after the sword and lapis are placed, and the wait is bounded at 40 ticks.
import { describe, expect, it } from 'vitest';
import { ENCHANT_OFFER_MAX_TICKS, waitForEnchantOffers } from './capture-enchant.ts';

/** A fake offer source: each read returns the next snapshot; the last one repeats. Each tick advances it. */
function fakeOffers(snapshots: number[][]) {
  let reads = 0;
  let ticks = 0;
  return {
    readLevels: () => {
      const at = Math.min(ticks, snapshots.length - 1);
      reads += 1;
      return snapshots[at] ?? [];
    },
    waitOneTick: async () => {
      ticks += 1;
    },
    get reads() {
      return reads;
    },
    get ticks() {
      return ticks;
    },
  };
}

describe('waitForEnchantOffers', () => {
  it('returns at once when an offer is already above 0, without waiting a tick', async () => {
    const fake = fakeOffers([[10, 20, 30]]);
    const out = await waitForEnchantOffers(fake.readLevels, fake.waitOneTick);
    expect(out).toEqual({ levels: [10, 20, 30], populated: true, ticks: 0 });
    expect(fake.ticks).toBe(0);
  });

  it('waits one tick at a time until an offer is populated, and counts the ticks it waited', async () => {
    const fake = fakeOffers([
      [-1, -1, -1],
      [-1, -1, -1],
      [-1, 5, -1],
    ]);
    const out = await waitForEnchantOffers(fake.readLevels, fake.waitOneTick);
    expect(out).toEqual({ levels: [-1, 5, -1], populated: true, ticks: 2 });
    expect(fake.ticks).toBe(2);
  });

  it('never fails on -1 offers: after the bound it returns the last levels, not populated', async () => {
    const fake = fakeOffers([[-1, -1, -1]]);
    const out = await waitForEnchantOffers(fake.readLevels, fake.waitOneTick);
    expect(out).toEqual({ levels: [-1, -1, -1], populated: false, ticks: ENCHANT_OFFER_MAX_TICKS });
    expect(fake.ticks).toBe(ENCHANT_OFFER_MAX_TICKS);
  });

  it('an offer that is populated by the 40th wait counts', async () => {
    expect(ENCHANT_OFFER_MAX_TICKS).toBe(40);
    const onTime = fakeOffers([
      ...Array.from({ length: ENCHANT_OFFER_MAX_TICKS }, () => [-1, -1, -1]),
      [7, -1, -1],
    ]);
    const out = await waitForEnchantOffers(onTime.readLevels, onTime.waitOneTick);
    expect(out).toEqual({ levels: [7, -1, -1], populated: true, ticks: ENCHANT_OFFER_MAX_TICKS });
    expect(onTime.ticks).toBe(ENCHANT_OFFER_MAX_TICKS);
  });

  it('an offer that appears only after the 40th wait is not waited for (no 41st tick)', async () => {
    const late = fakeOffers([
      ...Array.from({ length: ENCHANT_OFFER_MAX_TICKS + 1 }, () => [-1, -1, -1]),
      [7, -1, -1],
    ]);
    const out = await waitForEnchantOffers(late.readLevels, late.waitOneTick);
    expect(out.populated).toBe(false);
    expect(late.ticks).toBe(ENCHANT_OFFER_MAX_TICKS);
  });

  it('treats an empty offer list as not populated and keeps waiting', async () => {
    const fake = fakeOffers([[]]);
    const out = await waitForEnchantOffers(fake.readLevels, fake.waitOneTick, 3);
    expect(out).toEqual({ levels: [], populated: false, ticks: 3 });
  });

  it('a zero bound reads once and does not wait', async () => {
    const fake = fakeOffers([[-1, -1, -1]]);
    const out = await waitForEnchantOffers(fake.readLevels, fake.waitOneTick, 0);
    expect(out.populated).toBe(false);
    expect(out.ticks).toBe(0);
    expect(fake.ticks).toBe(0);
    expect(fake.reads).toBe(1);
  });

  it('a failing tick wait propagates (the case sees the error; the offers are not invented)', async () => {
    const readLevels = () => [-1, -1, -1];
    const waitOneTick = async () => {
      throw new Error('bot disconnected');
    };
    await expect(waitForEnchantOffers(readLevels, waitOneTick)).rejects.toThrow('bot disconnected');
  });
});
