import type { SimEvent } from '@geldar/mcp-mock';
import { describe, expect, it } from 'vitest';
import { reflexText, toPlayerEvents } from './present.ts';

describe('reflexText (no reflex is silent)', () => {
  it('names the reflex and what set it off, for each known reflex', () => {
    expect(reflexText('fall_stop', 'handled')).toBe(
      'Reflex fall_stop: you were falling, you braced.',
    );
    expect(reflexText('retreat', 'handled')).toBe(
      'Reflex retreat: your health was low with a hostile close, you walked back to safety.',
    );
    expect(reflexText('eat', 'handled')).toBe('Reflex eat: your hunger was low, so you ate.');
  });

  it('says when a reflex did not finish', () => {
    expect(reflexText('unstick', 'failed')).toBe(
      'Reflex unstick: you were stuck, you tried to get free. It did not finish.',
    );
  });

  it('never prints an unknown name or a name the table does not hold', () => {
    expect(reflexText('constructor', 'handled')).toBe('Reflex unknown: you acted on your own.');
    expect(reflexText(undefined, undefined)).toBe(
      'Reflex unknown: you acted on your own. It did not finish.',
    );
  });
});

describe('reflex repeats are rate-limited with a counter', () => {
  const firing = (seq: number, atMs: number, name = 'fall_stop'): SimEvent =>
    ({
      seq,
      tick: seq,
      atMs,
      wakeOn: null,
      kind: 'reflex',
      name,
      result: 'handled',
    }) as unknown as SimEvent;

  it('folds identical repeats inside the window into one line with a count', () => {
    const out = toPlayerEvents([firing(1, 0), firing(2, 1000), firing(3, 2500)]);
    expect(out.map((e) => e.text)).toEqual([
      'Reflex fall_stop: you were falling, you braced. (x3)',
    ]);
    expect(out[0]?.seq).toBe(1);
  });

  it('prints a repeat again once the window has passed', () => {
    const out = toPlayerEvents([firing(1, 0), firing(2, 1000), firing(3, 4000)]);
    expect(out.map((e) => e.text)).toEqual([
      'Reflex fall_stop: you were falling, you braced. (x2)',
      'Reflex fall_stop: you were falling, you braced.',
    ]);
  });

  it('never folds a different reflex into the run', () => {
    const out = toPlayerEvents([firing(1, 0), firing(2, 100, 'eat'), firing(3, 200)]);
    expect(out).toHaveLength(3);
    expect(out.map((e) => e.text)).not.toContain(
      'Reflex fall_stop: you were falling, you braced. (x2)',
    );
  });

  it('a single firing carries no counter', () => {
    expect(toPlayerEvents([firing(1, 0)]).map((e) => e.text)).toEqual([
      'Reflex fall_stop: you were falling, you braced.',
    ]);
  });
});

describe('damage text', () => {
  const damage = (amount: number, cause?: string) =>
    toPlayerEvents([
      {
        seq: 1,
        tick: 1,
        atMs: 0,
        wakeOn: null,
        kind: 'damage',
        amount,
        cause,
      } as unknown as SimEvent,
    ]).map((e) => e.text);

  it('says what hit you, from the mapped cause, and never the amount', () => {
    expect(damage(2.357, 'You fell.')).toEqual(['You fell.']);
    expect(damage(4, 'You are burning.')).toEqual(['You are burning.']);
  });

  it('says only that you were hurt when the cause is unknown', () => {
    expect(damage(3)).toEqual(['You were hurt.']);
  });

  it('prints no line for a zero or missing amount', () => {
    expect(damage(0, 'You fell.')).toEqual([]);
  });
});
