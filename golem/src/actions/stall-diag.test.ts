import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';

import { emitStallDiag, watchCorrections } from './stall-diag.ts';

const CONTROLS = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'];

/** A sink that appends each line and reads the test's own clock (ms). */
function sinkFor(lines: string[], clock: { t: number }) {
  return { log: (line: string) => lines.push(line), now: () => clock.t };
}

interface BodyOptions {
  held?: string[];
  position?: Vec3;
  blockAt?: (pos: Vec3) => { name: string } | null;
}

/**
 * A body shaped like mineflayer's: an emitter, controls as non-enumerable getters (as
 * lib/plugins/physics.js defines them), and a block reader that the test sets.
 */
function fakeBody(options: BodyOptions = {}) {
  const held = new Set(options.held ?? []);
  const controlState = {} as Record<string, boolean>;
  for (const name of CONTROLS) {
    Object.defineProperty(controlState, name, { get: () => held.has(name) });
  }
  return Object.assign(new EventEmitter(), {
    entity: {
      position: options.position ?? new Vec3(0.5, 64, 0.5),
      velocity: new Vec3(0, 0, 0),
      yaw: 0,
      pitch: 0,
      onGround: true,
      isInWater: false,
    },
    time: { age: 0 },
    controlState,
    blockAt: options.blockAt ?? (() => ({ name: 'air' })),
  });
}

const asBot = (fake: object): Bot => fake as unknown as Bot;

/** The parsed stall_diag line that `emitStallDiag` writes for this body at the clock's time. */
function stallLine(body: object, clock: { t: number }): Record<string, unknown> {
  const lines: string[] = [];
  emitStallDiag(asBot(body), { reason: 'stall' }, sinkFor(lines, clock));
  return JSON.parse(lines[0] ?? '{}');
}

describe('stall_diag controls', () => {
  it('shows a held jump, which mineflayer keeps in a hidden getter', () => {
    const body = fakeBody({ held: ['jump', 'forward'] });
    expect(stallLine(body, { t: 0 })).toMatchObject({
      control: { jump: true, forward: true },
    });
  });

  it('lists only the controls that are held', () => {
    const body = fakeBody({ held: ['jump'] });
    expect(stallLine(body, { t: 0 }).control).toEqual({ jump: true });
  });

  it('lists nothing when no control is held', () => {
    expect(stallLine(fakeBody(), { t: 0 }).control).toEqual({});
  });
});

describe('stall_diag blocks below and at the feet', () => {
  it('names the block below the feet cell and the feet cell', () => {
    const body = fakeBody({
      position: new Vec3(0.5, 64, 0.5),
      blockAt: (pos) => ({ name: pos.y === 63 ? 'stone' : 'air' }),
    });
    expect(stallLine(body, { t: 0 })).toMatchObject({
      blocks: { below: 'stone', at: 'air' },
    });
  });

  it('reports null for below and at when the chunk is not loaded', () => {
    const body = fakeBody({ blockAt: () => null });
    expect(stallLine(body, { t: 0 })).toMatchObject({
      blocks: { below: null, at: null },
    });
  });
});

describe('server position corrections', () => {
  it('counts three forcedMove events before a stall line as corrections_10s 3', () => {
    const body = fakeBody();
    const clock = { t: 0 };
    watchCorrections(asBot(body), sinkFor([], clock));
    body.emit('forcedMove');
    clock.t = 1_000;
    body.emit('forcedMove');
    clock.t = 2_000;
    body.emit('forcedMove');
    clock.t = 3_000;
    expect(stallLine(body, clock)).toMatchObject({ corrections_10s: 3 });
  });

  it('stops counting a correction once it is 10 s old', () => {
    const early = fakeBody();
    const late = fakeBody();
    watchCorrections(asBot(early), sinkFor([], { t: 0 }));
    watchCorrections(asBot(late), sinkFor([], { t: 0 }));
    early.emit('forcedMove');
    late.emit('forcedMove');
    expect(stallLine(early, { t: 9_999 })).toMatchObject({ corrections_10s: 1 });
    expect(stallLine(late, { t: 10_000 })).toMatchObject({ corrections_10s: 0 });
  });

  it('reports ticks since the last correction, and null before the first', () => {
    const fresh = fakeBody();
    watchCorrections(asBot(fresh), sinkFor([], { t: 0 }));
    expect(stallLine(fresh, { t: 0 })).toMatchObject({
      corrections_10s: 0,
      ticks_since_correction: null,
    });
    const body = fakeBody();
    const clock = { t: 0 };
    watchCorrections(asBot(body), sinkFor([], clock));
    body.time.age = 40;
    body.emit('forcedMove');
    body.time.age = 55;
    clock.t = 1_000;
    expect(stallLine(body, clock)).toMatchObject({
      corrections_10s: 1,
      ticks_since_correction: 15,
    });
  });

  it('counts each correction once when the watcher is attached twice', () => {
    const body = fakeBody();
    const clock = { t: 0 };
    watchCorrections(asBot(body), sinkFor([], clock));
    watchCorrections(asBot(body), sinkFor([], clock));
    body.emit('forcedMove');
    expect(stallLine(body, clock)).toMatchObject({ corrections_10s: 1 });
  });

  it('does not throw on a bot with no emitter, and counts nothing', () => {
    const bare = {
      entity: { position: new Vec3(0, 64, 0) },
      time: { age: 0 },
      blockAt: () => null,
    };
    expect(() => watchCorrections(asBot(bare), sinkFor([], { t: 0 }))).not.toThrow();
    expect(stallLine(bare, { t: 0 })).toMatchObject({ corrections_10s: 0 });
  });

  it('writes forced_move with the server and client positions, at most once per 5 s', () => {
    const body = fakeBody({ position: new Vec3(10.5, 64, 10.5) });
    const clock = { t: 0 };
    const lines: string[] = [];
    watchCorrections(asBot(body), sinkFor(lines, clock));
    body.emit('physicsTick');
    body.entity.position = new Vec3(10.5, 64, 12.5);
    body.emit('forcedMove');
    clock.t = 1_000;
    body.emit('forcedMove');
    clock.t = 4_999;
    body.emit('forcedMove');
    clock.t = 5_000;
    body.emit('forcedMove');
    const forced = lines
      .map((line) => JSON.parse(line))
      .filter((line) => line.event === 'forced_move');
    expect(forced).toHaveLength(2);
    expect(forced[0]).toEqual({
      event: 'forced_move',
      server: { x: 10.5, y: 64, z: 12.5 },
      client_before: { x: 10.5, y: 64, z: 10.5 },
    });
  });
});
