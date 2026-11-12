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
});
