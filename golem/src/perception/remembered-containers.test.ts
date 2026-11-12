import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  MAX_REMEMBERED_CONTAINERS,
  RememberedContainers,
} from './remembered-containers.ts';

const T0 = 1_000_000_000_000;
const at = (x: number) => ({ x, y: 64, z: 0 });
const chest = [{ item: 'cobblestone', count: 3 }];

describe('RememberedContainers', () => {
  it('recalls what a container held at the last open, with age 0 on the same day', () => {
    const memory = new RememberedContainers();
    memory.record(at(1), { contents: chest }, T0);
    expect(memory.recall(at(1), T0)).toEqual({ status: 'known', age_days: 0, contents: chest });
  });

  it('counts whole days since the last open', () => {
    const memory = new RememberedContainers();
    memory.record(at(1), { contents: chest }, T0);
    expect(memory.recall(at(1), T0 + 2 * DAY_MS + 1000)).toMatchObject({ age_days: 2 });
  });

  it('answers unknown for a container never opened, never with contents', () => {
    const memory = new RememberedContainers();
    memory.record(at(1), { contents: chest }, T0);
    const result = memory.recall(at(2), T0);
    expect(result).toEqual({ status: 'unknown' });
    expect(result).not.toHaveProperty('contents');
  });

  it('replaces the contents and resets the age when the container is opened again', () => {
    const memory = new RememberedContainers();
    memory.record(at(1), { contents: chest }, T0);
    const later = [{ item: 'coal', count: 8 }];
    memory.record(at(1), { contents: later }, T0 + 3 * DAY_MS);
    expect(memory.recall(at(1), T0 + 3 * DAY_MS)).toEqual({
      status: 'known',
      age_days: 0,
      contents: later,
    });
    expect(memory.size).toBe(1);
  });

  it('keeps the furnace slots and progress of a furnace', () => {
    const memory = new RememberedContainers();
    const furnace = {
      input: { item: 'iron_ore', count: 2 },
      fuel: null,
      output: null,
      progress: 40,
    };
    memory.record(at(1), { contents: [], furnace }, T0);
    expect(memory.recall(at(1), T0)).toMatchObject({ status: 'known', furnace });
  });

  it('keeps 64 containers: the 64th is still remembered', () => {
    const memory = new RememberedContainers();
    for (let x = 0; x < MAX_REMEMBERED_CONTAINERS; x++) {
      memory.record(at(x), { contents: chest }, T0);
    }
    expect(memory.size).toBe(64);
    expect(memory.recall(at(MAX_REMEMBERED_CONTAINERS - 1), T0)).toMatchObject({ status: 'known' });
    expect(memory.recall(at(0), T0)).toMatchObject({ status: 'known' });
  });

  it('evicts the oldest on the 65th container', () => {
    const memory = new RememberedContainers();
    for (let x = 0; x <= MAX_REMEMBERED_CONTAINERS; x++) {
      memory.record(at(x), { contents: chest }, T0);
    }
    expect(memory.size).toBe(64);
    expect(memory.recall(at(0), T0)).toEqual({ status: 'unknown' });
    expect(memory.recall(at(1), T0)).toMatchObject({ status: 'known' });
  });

  it('a re-open makes the container the newest, so the next eviction takes another', () => {
    const memory = new RememberedContainers();
    for (let x = 0; x < MAX_REMEMBERED_CONTAINERS; x++) {
      memory.record(at(x), { contents: chest }, T0);
    }
    memory.record(at(0), { contents: chest }, T0);
    memory.record(at(MAX_REMEMBERED_CONTAINERS), { contents: chest }, T0);
    expect(memory.recall(at(0), T0)).toMatchObject({ status: 'known' });
    expect(memory.recall(at(1), T0)).toEqual({ status: 'unknown' });
  });
});
