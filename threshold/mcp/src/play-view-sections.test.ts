import { buildSnapshot } from '@geldar/mcp-mock';
import { describe, expect, it } from 'vitest';
import type { PlayViewOptions, SnapshotProjector } from './play-view/types.ts';
import { composePlayView, SNAPSHOT_PROJECTORS, toPlayView } from './play-view.ts';

const OPTIONS: PlayViewOptions = { budget: 99, daysSinceSleep: 0 };

function snapshot() {
  return buildSnapshot({
    agentId: 'ag_ranger_01',
    shard: 'phase0',
    revision: 4,
    snapshotN: 1,
    day: 3,
    ticks: 12000,
    timeOfDay: 'dusk',
    position: { x: 10, y: 64, z: -5 },
    health: 18,
    food: 15,
    inventory: [],
    neighbours: [{ name: 'Mallory', distance: 4 }],
    budget: 99,
    daysSinceSleep: 0,
  });
}

/** A section the built-in projectors do not build. The cast is for the fixture only: the key is not in PlaySnapshot. */
const weather = (() => ({ weather_note: 'Rain.' })) as unknown as SnapshotProjector;

describe('play-view sections', () => {
  it('an extra projector adds its section after the built-in ones', () => {
    const view = composePlayView(snapshot(), OPTIONS, [...SNAPSHOT_PROJECTORS, weather]);
    expect(view.snapshot).toMatchObject({ weather_note: 'Rain.' });
    expect(Object.keys(view.snapshot).slice(-1)).toEqual(['weather_note']);
  });

  it('with no extra projector the view is the built-in one', () => {
    expect(composePlayView(snapshot(), OPTIONS, SNAPSHOT_PROJECTORS)).toEqual(
      toPlayView(snapshot(), OPTIONS),
    );
  });

  it('an extra projector leaves the untrusted part as it was', () => {
    const extended = composePlayView(snapshot(), OPTIONS, [...SNAPSHOT_PROJECTORS, weather]);
    expect(extended.untrusted).toEqual(toPlayView(snapshot(), OPTIONS).untrusted);
  });

  it('a projector listed first comes first in the snapshot part', () => {
    const view = composePlayView(snapshot(), OPTIONS, [weather, ...SNAPSHOT_PROJECTORS]);
    expect(Object.keys(view.snapshot)[0]).toBe('weather_note');
  });
});
