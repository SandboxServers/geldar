import type { MindEvent } from '@geldar/animus/src/ports/body.ts';
import type { SimEvent } from '@geldar/mcp-mock';
import { describe, expect, it } from 'vitest';
import { mapMindEvent } from '../mapper.ts';
import { PRESENT_HANDLERS, presentEvents } from '../present-handlers/index.ts';

const ctx = { identity: {} as never, runs: new Map() };

/** A heard_sound Mind event with the given payload. */
function heard(payload: Record<string, unknown>): MindEvent {
  return {
    type: 'heard_sound',
    payload,
    eventId: 'e1',
    lifeId: 'life-1',
    tick: 1200,
    day: 0,
    at: '2026-01-01T00:00:00.000Z',
  } as unknown as MindEvent;
}

/** The player's text for one heard sound, through the mapper and the presenter. */
function sentenceOf(payload: Record<string, unknown>): string | undefined {
  const sim = mapMindEvent(heard(payload), 7, ctx);
  const lines = presentEvents(PRESENT_HANDLERS, sim);
  return lines[0]?.text;
}

describe('heard_sound mapping', () => {
  it('maps a hiss close to the north to the fixed sentence', () => {
    const sim = mapMindEvent(
      heard({ type: 'heard_sound', sound: 'hiss', dir: 'n', band: 'near' }),
      7,
      ctx,
    );
    expect(sim).toEqual([
      expect.objectContaining({ seq: 7, tick: 1200, kind: 'heard_sound', wakeOn: null }),
    ]);
    expect(sim[0]?.text).toBe('You hear hissing close to the north.');
  });

  it('presents the sentence as a heard_sound line', () => {
    const sim = mapMindEvent(
      heard({ type: 'heard_sound', sound: 'hiss', dir: 'n', band: 'near' }),
      7,
      ctx,
    );
    const lines = presentEvents(PRESENT_HANDLERS, sim as SimEvent[]);
    expect(lines).toEqual([
      { seq: 7, tick: 1200, type: 'heard_sound', text: 'You hear hissing close to the north.' },
    ]);
  });

  it.each([
    ['near', 'close to', 'e', 'east'],
    ['mid', 'to', 'se', 'southeast'],
    ['far', 'far off to', 'sw', 'southwest'],
    ['far', 'far off to', 'w', 'west'],
  ])('reads the %s band as "%s" and the point %s as %s', (band, lead, dir, word) => {
    expect(sentenceOf({ type: 'heard_sound', sound: 'growl', dir, band })).toBe(
      `You hear a growl ${lead} the ${word}.`,
    );
  });

  it('reads every compass point on every axis and diagonal', () => {
    const cases: [string, string][] = [
      ['n', 'north'],
      ['ne', 'northeast'],
      ['e', 'east'],
      ['se', 'southeast'],
      ['s', 'south'],
      ['sw', 'southwest'],
      ['w', 'west'],
      ['nw', 'northwest'],
    ];
    for (const [dir, word] of cases) {
      expect(sentenceOf({ type: 'heard_sound', sound: 'thunder', dir, band: 'mid' })).toBe(
        `You hear thunder to the ${word}.`,
      );
    }
  });

  it('keeps only the sound when the band or the point is unknown', () => {
    expect(sentenceOf({ type: 'heard_sound', sound: 'hiss', dir: 'n', band: 'huge' })).toBe(
      'You hear hissing.',
    );
    expect(sentenceOf({ type: 'heard_sound', sound: 'hiss', dir: 'up', band: 'near' })).toBe(
      'You hear hissing.',
    );
  });

  it('reads an unknown sound kind as a sound, never as the raw value', () => {
    expect(sentenceOf({ type: 'heard_sound', sound: 'constructor', dir: 'n', band: 'near' })).toBe(
      'You hear a sound close to the north.',
    );
  });

  it('never shows coordinates, even if the payload carries them', () => {
    const text = sentenceOf({
      type: 'heard_sound',
      sound: 'explosion',
      dir: 's',
      band: 'far',
      x: 120,
      y: 64,
      z: -33,
    });
    expect(text).toBe('You hear an explosion far off to the south.');
    expect(text).not.toMatch(/\d/);
  });

  it('a heard sound with no mapper handler would map to nothing (the registry line is the link)', () => {
    const sim = mapMindEvent(
      heard({ type: 'heard_sound', sound: 'hiss', dir: 'n', band: 'near' }),
      1,
      ctx,
    );
    expect(sim).toHaveLength(1);
  });
});
