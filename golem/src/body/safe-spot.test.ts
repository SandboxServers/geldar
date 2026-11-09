import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { trackSafeSpot } from './safe-spot.ts';
import { createBodyView } from './view.ts';

/** A bot with a position, a world spawn and a block lookup the test controls. */
function bot(blocks: Record<string, string | null> = {}) {
  const emitter = new EventEmitter() as unknown as Record<string, unknown>;
  emitter.entity = { position: new Vec3(10.5, 64.2, -3.5), onGround: true };
  emitter.spawnPoint = new Vec3(100, 70, 200);
  emitter.health = 20;
  emitter.entities = {};
  emitter.blockAt = (at: Vec3) => {
    const name = blocks[`${at.x},${at.y},${at.z}`];
    return name === undefined || name === null ? null : { name };
  };
  return { bot: emitter as unknown as Bot, events: emitter as unknown as EventEmitter };
}

describe('trackSafeSpot', () => {
  it('falls back to the world spawn when no bed is known', () => {
    const { bot: b } = bot();
    const memory = trackSafeSpot(b);
    expect(memory.current()).toEqual({ kind: 'spawn', position: { x: 100, y: 70, z: 200 } });
  });

  it('remembers the bed the Body slept in and prefers it to the spawn', () => {
    const { bot: b, events } = bot({ '10,64,-4': 'red_bed' });
    const memory = trackSafeSpot(b);
    events.emit('sleep');
    expect(memory.current()).toEqual({ kind: 'bed', position: { x: 10, y: 64, z: -4 } });
  });

  it('forgets a bed that is gone from a loaded chunk', () => {
    const { bot: b, events } = bot({ '10,64,-4': 'air' });
    const memory = trackSafeSpot(b);
    events.emit('sleep');
    expect(memory.current()?.kind).toBe('spawn');
  });

  it('keeps a bed whose chunk is not loaded', () => {
    const { bot: b, events } = bot();
    const memory = trackSafeSpot(b);
    events.emit('sleep');
    expect(memory.current()?.kind).toBe('bed');
  });

  it('stops listening on dispose', () => {
    const { bot: b, events } = bot();
    const memory = trackSafeSpot(b);
    memory.dispose();
    events.emit('sleep');
    expect(memory.current()?.kind).toBe('spawn');
  });
});

describe('BodyView hurt and safe-spot fields', () => {
  it('counts physics ticks since the health last dropped', () => {
    const { bot: b, events } = bot();
    const view = createBodyView(b);
    expect(view.ticksSinceHurt).toBeNull();
    (b as unknown as { health: number }).health = 14;
    events.emit('health');
    events.emit('physicsTick');
    events.emit('physicsTick');
    expect(view.ticksSinceHurt).toBe(2);
    // A health gain is not a hurt: the counter keeps running.
    (b as unknown as { health: number }).health = 16;
    events.emit('health');
    events.emit('physicsTick');
    expect(view.ticksSinceHurt).toBe(3);
    expect(view.safeSpot?.kind).toBe('spawn');
    view.dispose();
  });
});

describe('trackSafeSpot: a forgotten bed stays forgotten', () => {
  it('does not bring the bed back when a bed block appears there again', () => {
    const blocks: Record<string, string | null> = { '10,64,-4': 'air' };
    const { bot: b, events } = bot(blocks);
    const memory = trackSafeSpot(b);
    events.emit('sleep');
    expect(memory.current()?.kind).toBe('spawn');
    blocks['10,64,-4'] = 'red_bed';
    expect(memory.current()?.kind).toBe('spawn');
  });
});
