import type { Snapshot } from '@geldar/contract';
import { buildSnapshot } from '@geldar/mcp-mock';
import { describe, expect, it } from 'vitest';
import { toPlayView } from '../play-view.ts';
import type { PlayViewOptions } from './types.ts';

const OPTIONS: PlayViewOptions = { budget: 99, daysSinceSleep: 0 };

function withHazards(hazards?: Snapshot['surroundings']['hazards']): Snapshot {
  const base = buildSnapshot({
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
    neighbours: [],
    budget: 99,
    daysSinceSleep: 0,
  });
  const surroundings: Snapshot['surroundings'] = { ...base.surroundings };
  if (hazards === undefined) delete surroundings.hazards;
  else surroundings.hazards = hazards;
  return { ...base, surroundings };
}

describe('play-view hazards', () => {
  it('projects the hazards under surroundings, in the order the Body listed them', () => {
    const hazards: NonNullable<Snapshot['surroundings']['hazards']> = [
      { kind: 'lava', dir: 'w', dist: 2 },
      { kind: 'drop', dir: 'n', dist: 5 },
    ];
    const view = toPlayView(withHazards(hazards), OPTIONS);
    expect(view.snapshot.surroundings.hazards).toEqual(hazards);
  });

  it('keeps the other surroundings fields beside the hazards', () => {
    const view = toPlayView(withHazards([{ kind: 'cactus', dir: 'ne', dist: 3 }]), OPTIONS);
    expect(view.snapshot.surroundings.blocks_summary).toBeDefined();
    expect(view.snapshot.surroundings.hazards).toHaveLength(1);
  });

  it('leaves the key out when the Body reports no hazards', () => {
    const view = toPlayView(withHazards(), OPTIONS);
    expect(view.snapshot.surroundings).not.toHaveProperty('hazards');
  });
});
