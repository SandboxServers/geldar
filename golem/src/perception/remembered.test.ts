import { describe, expect, it } from 'vitest';
import { MAX_REMEMBERED, RememberedBlocks } from './remembered.ts';

describe('RememberedBlocks', () => {
  it('holds at most 256 entries and drops the oldest sighting first', () => {
    const memory = new RememberedBlocks();
    for (let i = 0; i < MAX_REMEMBERED + 10; i++)
      memory.remember({ type: 'chest', x: i, y: 64, z: 0 });
    expect(MAX_REMEMBERED).toBe(256);
    expect(memory.size).toBe(256);
    expect(memory.at(0, 64, 0)).toBeUndefined();
    expect(memory.at(9, 64, 0)).toBeUndefined();
    expect(memory.at(10, 64, 0)).toBeDefined();
    expect(memory.at(265, 64, 0)).toBeDefined();
  });

  it('replaces the entry at a position with a re-observed change', () => {
    const memory = new RememberedBlocks();
    memory.remember({ type: 'chest', x: 1, y: 64, z: 1 });
    memory.remember({ type: 'barrel', x: 1, y: 64, z: 1 });
    expect(memory.size).toBe(1);
    expect(memory.at(1, 64, 1)?.type).toBe('barrel');
  });

  it('keeps a re-sighted entry when older ones are dropped', () => {
    const memory = new RememberedBlocks();
    memory.remember({ type: 'chest', x: 0, y: 64, z: 0 });
    for (let i = 1; i < MAX_REMEMBERED; i++) memory.remember({ type: 'chest', x: i, y: 64, z: 0 });
    memory.remember({ type: 'chest', x: 0, y: 64, z: 0 });
    memory.remember({ type: 'chest', x: 999, y: 64, z: 0 });
    expect(memory.at(0, 64, 0)).toBeDefined();
    expect(memory.at(1, 64, 0)).toBeUndefined();
  });

  it('never stores sign text', () => {
    const memory = new RememberedBlocks();
    memory.remember({ type: 'oak_sign', x: 0, y: 64, z: 0, text: 'hi' } as never);
    expect(memory.at(0, 64, 0)).toEqual({ type: 'oak_sign', x: 0, y: 64, z: 0 });
  });

  it('forgets an entry', () => {
    const memory = new RememberedBlocks();
    memory.remember({ type: 'chest', x: 1, y: 64, z: 1 });
    memory.forget(1, 64, 1);
    expect(memory.size).toBe(0);
  });
});
