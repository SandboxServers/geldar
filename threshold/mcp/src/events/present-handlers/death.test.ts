import type { SimEvent } from '@geldar/mcp-mock';
import { describe, expect, it } from 'vitest';
import { deathPresenter } from './death.ts';
import type { PresentCall } from './types.ts';

const call: PresentCall = { overheard: [], lastOverheard: undefined, lastReflex: null };
const base = { seq: 7, tick: 100 };

function death(extra: Partial<SimEvent> = {}): SimEvent {
  return { kind: 'death', seq: 7, tick: 100, cause: 'You fell too far', ...extra } as SimEvent;
}

describe('death presenter: place, drops and respawn', () => {
  it('a death with drops gives one death line with the place and one drop line', () => {
    const out = deathPresenter.present(
      death({ where: { x: 12, z: -7 }, drops: 5, respawn_point: { x: 0, y: 64, z: 0 } }),
      base,
      call,
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      type: 'death',
      text: 'You died. You fell too far. You wake at the spawn with nothing.',
      where: { x: 12, z: -7 },
      respawn_point: { x: 0, y: 64, z: 0 },
    });
    expect(out[1]).toMatchObject({
      type: 'death',
      text: 'You dropped 5 items where you died.',
      drops: 5,
    });
  });

  it('a death with no drops emits no drop line, and zero drops is no drop line either', () => {
    expect(deathPresenter.present(death({ drops: 0 }), base, call)).toHaveLength(1);
    expect(deathPresenter.present(death(), base, call)).toHaveLength(1);
  });

  it('a single dropped item is said in the singular', () => {
    const out = deathPresenter.present(death({ drops: 1 }), base, call);
    expect(out[1]).toMatchObject({ text: 'You dropped 1 item where you died.' });
  });

  it('the respawn point is stated once: on the death line, not on the drop line', () => {
    const out = deathPresenter.present(
      death({ drops: 2, respawn_point: { x: -3, y: 70, z: 9 } }),
      base,
      call,
    );
    expect(out[0]).toMatchObject({ respawn_point: { x: -3, y: 70, z: 9 } });
    expect(out[1]).not.toHaveProperty('respawn_point');
  });

  it('a place with negative x and z is carried as given, on both signs', () => {
    const out = deathPresenter.present(death({ where: { x: -40, z: 25 } }), base, call);
    expect(out[0]).toMatchObject({ where: { x: -40, z: 25 } });
  });

  it('says the dimension in the death line, and keeps the old line when it is absent', () => {
    const out = deathPresenter.present(death({ dimension: 'nether' }), base, call);
    expect(out[0]).toMatchObject({
      text: 'You died in the nether. You fell too far. You wake at the spawn with nothing.',
    });
    const none = deathPresenter.present(death(), base, call);
    expect(none[0]).toMatchObject({
      text: 'You died. You fell too far. You wake at the spawn with nothing.',
    });
  });

  it('words each dimension, and an unknown one as another world', () => {
    const words: [NonNullable<SimEvent['dimension']>, string][] = [
      ['overworld', 'the overworld'],
      ['end', 'the end'],
      ['other', 'another world'],
    ];
    for (const [dimension, phrase] of words) {
      const out = deathPresenter.present(death({ dimension }), base, call);
      expect(out[0]).toMatchObject({
        text: `You died in ${phrase}. You fell too far. You wake at the spawn with nothing.`,
      });
    }
  });

  it('names the dropped stacks with counts and the place, in one drop line', () => {
    const out = deathPresenter.present(
      death({
        drops: 4,
        drop_items: [
          { item: 'oak_log', count: 3, x: 190, y: 61, z: 224 },
          { item: 'stone_pickaxe', count: 1, x: 190, y: 61, z: 224 },
        ],
      }),
      base,
      call,
    );
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({
      type: 'death',
      text: 'You dropped 3 oak_log, 1 stone_pickaxe near x=190 y=61 z=224.',
    });
  });

  it('lists five stacks, then says how many more there are', () => {
    const drop_items = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((item, i) => ({
      item,
      count: i + 1,
    }));
    const out = deathPresenter.present(death({ drops: 28, drop_items }), base, call);
    expect(out).toHaveLength(2);
    expect(out[1]?.text).toBe('You dropped 1 a, 2 b, 3 c, 4 d, 5 e, and 2 more.');
  });

  it('gives no place when no stack carries all three coordinates', () => {
    const out = deathPresenter.present(
      death({ drop_items: [{ item: 'dirt', count: 2, x: 1, z: 2 }] }),
      base,
      call,
    );
    expect(out[1]?.text).toBe('You dropped 2 dirt.');
  });

  it('with no drop_items it falls back to the count line, and never names items', () => {
    const out = deathPresenter.present(death({ drops: 5 }), base, call);
    expect(out[1]).toMatchObject({ text: 'You dropped 5 items where you died.', drops: 5 });
    expect(out[1]?.text).not.toMatch(/oak_log|stone/);
  });

  it('a death with no drops, and an empty drop_items list, gives no drop line', () => {
    expect(deathPresenter.present(death({ drops: 0, drop_items: [] }), base, call)).toHaveLength(1);
  });
});
