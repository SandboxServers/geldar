import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import { bandOf, type HeardSound, pointOf, soundKindOf, watchSounds } from './sounds.ts';

const HISS = 'entity.creeper.primed';

/** A bot with a body at the origin (or where it is placed) and a clock the test moves by hand. */
function listen(self: { x: number; y: number; z: number } | null = { x: 0, y: 64, z: 0 }) {
  const emitter = new EventEmitter();
  const bot = Object.assign(emitter, { entity: self === null ? undefined : { position: self } });
  const out: HeardSound[] = [];
  const clock = { t: 0 };
  const detach = watchSounds(
    bot as unknown as Bot,
    (s) => out.push(s),
    () => clock.t,
  );
  const hear = (name: string, x: number, z: number, y = 64) => {
    bot.emit('soundEffectHeard', name, { x, y, z }, 1, 1);
  };
  return { bot, out, clock, detach, hear };
}

describe('pointOf: the world-fixed compass on every axis and sign', () => {
  it.each([
    ['+x', 4, 0, 'e'],
    ['-x', -4, 0, 'w'],
    ['+z', 0, 4, 's'],
    ['-z', 0, -4, 'n'],
    ['+x +z', 3, 3, 'se'],
    ['-x -z', -3, -3, 'nw'],
    ['+x -z', 3, -3, 'ne'],
    ['-x +z', -3, 3, 'sw'],
  ])('offset %s (dx %d, dz %d) gives %s', (_label, dx, dz, dir) => {
    expect(pointOf(dx, dz)).toBe(dir);
  });

  it('reads a sound on each axis through the listener', () => {
    const { out, clock, hear } = listen();
    const cases: Array<[number, number, string]> = [
      [4, 0, 'e'],
      [-4, 0, 'w'],
      [0, 4, 's'],
      [0, -4, 'n'],
    ];
    for (const [x, z, dir] of cases) {
      clock.t += 10_000;
      hear(HISS, x, z);
      expect(out[out.length - 1]?.dir).toBe(dir);
    }
  });
});

describe('bandOf: distance bands and the radius', () => {
  it.each([
    [8, 'near'],
    [9, 'mid'],
    [16, 'mid'],
    [17, 'far'],
    [24, 'far'],
    [25, null],
  ])('distance %d gives %s', (distance, band) => {
    expect(bandOf(distance)).toBe(band);
  });

  it('the listener drops a sound at 25 blocks and bands the others', () => {
    const { out, clock, hear } = listen();
    for (const d of [8, 9, 16, 17, 24, 25]) {
      clock.t += 10_000;
      hear(HISS, d, 0);
    }
    expect(out.map((s) => s.band)).toEqual(['near', 'mid', 'mid', 'far', 'far']);
  });
});

describe('the per-kind limiter', () => {
  it('drops a second hiss within 10 s', () => {
    const { out, clock, hear } = listen();
    hear(HISS, 4, 0);
    clock.t = 9_999;
    hear(HISS, 4, 0);
    expect(out).toHaveLength(1);
  });

  it('allows a hiss at exactly 10 s', () => {
    const { out, clock, hear } = listen();
    hear(HISS, 4, 0);
    clock.t = 10_000;
    hear(HISS, 4, 0);
    expect(out).toHaveLength(2);
  });

  it('allows a different kind inside the window', () => {
    const { out, clock, hear } = listen();
    hear(HISS, 4, 0);
    clock.t = 5_000;
    hear('entity.skeleton.shoot', 4, 0);
    expect(out.map((s) => s.sound)).toEqual(['hiss', 'bow']);
  });
});

describe('abort, close and error paths', () => {
  it('after detach nothing is reported and the listener is removed', () => {
    const { bot, out, detach, hear } = listen();
    detach();
    hear(HISS, 4, 0);
    expect(out).toHaveLength(0);
    expect(bot.listenerCount('soundEffectHeard')).toBe(0);
  });

  it('an unknown sound name is ignored without a throw', () => {
    const { out, hear } = listen();
    expect(() => hear('entity.cow.ambient', 4, 0)).not.toThrow();
    expect(out).toHaveLength(0);
    expect(soundKindOf('entity.cow.ambient')).toBeNull();
    expect(soundKindOf(undefined)).toBeNull();
  });

  it('a sound with no position is ignored', () => {
    const { bot, out } = listen();
    expect(() => bot.emit('soundEffectHeard', HISS, null, 1, 1)).not.toThrow();
    expect(out).toHaveLength(0);
  });

  it('a Body with no entity hears nothing', () => {
    const { out, hear } = listen(null);
    hear(HISS, 4, 0);
    expect(out).toHaveLength(0);
  });
});

describe('coordinates never leave the Golem', () => {
  it('a reported sound carries only type, sound, dir and band', () => {
    const { out, clock, hear } = listen();
    hear(HISS, 4, 0);
    clock.t = 0;
    expect(Object.keys(out[0] ?? {}).sort()).toEqual(['band', 'dir', 'sound', 'type']);
    expect(out[0]).toEqual({ type: 'heard_sound', sound: 'hiss', dir: 'e', band: 'near' });
  });
});
