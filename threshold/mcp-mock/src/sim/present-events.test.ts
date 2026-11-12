import { describe, expect, it } from 'vitest';
import type { SimEvent } from './events.ts';
import { PRESENT_HANDLERS, presentEvents } from './present-events/index.ts';
import { definePresentHandler } from './present-events/types.ts';

function planResult(seq: number): SimEvent {
  return { seq, tick: 5, atMs: 0, wakeOn: null, kind: 'plan_result' } as unknown as SimEvent;
}

function addressedSpeech(seq: number): SimEvent {
  return {
    seq,
    tick: 2,
    atMs: 0,
    wakeOn: null,
    kind: 'speech',
    addressed: true,
    from: 'Zack',
  } as unknown as SimEvent;
}

/** A presenter for plan_result, which no built-in presenter shows. */
const extra = definePresentHandler('plan_result', (_e, base) => [
  { ...base, type: 'speech_to_me', text: 'Extra line.' },
]);

describe('mock present-events registry', () => {
  it('a kind with no presenter gives no player line', () => {
    expect(presentEvents(PRESENT_HANDLERS, [planResult(1)])).toEqual([]);
  });

  it('an extra presenter adds its line without editing the registry', () => {
    expect(presentEvents([...PRESENT_HANDLERS, extra], [planResult(1)])).toEqual([
      { seq: 1, tick: 5, type: 'speech_to_me', text: 'Extra line.' },
    ]);
  });

  it('the built-in presenters keep their lines with an extra one appended', () => {
    const speech = [addressedSpeech(3)];
    expect(presentEvents([...PRESENT_HANDLERS, extra], speech)).toEqual(
      presentEvents(PRESENT_HANDLERS, speech),
    );
    expect(presentEvents(PRESENT_HANDLERS, speech)).toEqual([
      { seq: 3, tick: 2, type: 'speech_to_me', text: 'Someone spoke to you.' },
    ]);
  });

  it('the first presenter of a kind wins, so the order of the list decides', () => {
    const firstSpeech = definePresentHandler('speech', (_e, base) => [
      { ...base, type: 'speech_to_me', text: 'First.' },
    ]);
    expect(presentEvents([firstSpeech, ...PRESENT_HANDLERS], [addressedSpeech(4)])).toEqual([
      { seq: 4, tick: 2, type: 'speech_to_me', text: 'First.' },
    ]);
  });

  it('the built-in registry has one presenter per kind, twelve in all', () => {
    const kinds = PRESENT_HANDLERS.map((h) => h.kind);
    expect(kinds).toHaveLength(12);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});
