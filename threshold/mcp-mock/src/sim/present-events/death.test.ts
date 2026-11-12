import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../events.ts';
import { deathPresenter } from './death.ts';
import type { PresentCall } from './types.ts';

const call: PresentCall = { overheard: [], lastOverheard: undefined };
const base = { seq: 7, tick: 100 };

function death(extra: Partial<SimEvent> = {}): SimEvent {
  return { kind: 'death', seq: 7, tick: 100, cause: 'You fell too far', ...extra } as SimEvent;
}

describe('death presenter (mock): dimension and dropped names', () => {
  it('says the dimension in the death line, and the old line when it is absent', () => {
    expect(deathPresenter.present(death({ dimension: 'nether' }), base, call)[0]).toMatchObject({
      text: 'You died in the nether. You fell too far. You wake at the spawn with nothing.',
    });
    expect(deathPresenter.present(death(), base, call)[0]).toMatchObject({
      text: 'You died. You fell too far. You wake at the spawn with nothing.',
    });
  });

  it('names the stacks in one drop line, with the place of the first full one', () => {
    const out = deathPresenter.present(
      death({
        drops: 3,
        drop_items: [{ item: 'oak_log', count: 3, x: 190, y: 61, z: 224 }],
      }),
      base,
      call,
    );
    expect(out[1]).toMatchObject({ text: 'You dropped 3 oak_log near x=190 y=61 z=224.' });
  });

  it('falls back to the count line when drop_items is absent, with no item names', () => {
    const out = deathPresenter.present(death({ drops: 2 }), base, call);
    expect(out[1]).toMatchObject({ text: 'You dropped 2 items where you died.', drops: 2 });
  });
});
