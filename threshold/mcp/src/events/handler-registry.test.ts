import type { MindEvent } from '@geldar/animus/src/ports/body.ts';
import type { SimEvent } from '@geldar/mcp-mock';
import { describe, expect, it } from 'vitest';
import { MIND_HANDLERS } from './handlers/index.ts';
import { defineMindHandler, type MapContext } from './handlers/types.ts';
import { mapMindEvent, mapMindEventWith } from './mapper.ts';

const LIFE = 'ag_jason_01';
const AT = '2026-11-09T10:00:00.000Z';

function ctx(): MapContext {
  return { identity: { name: 'Jason', username: LIFE }, runs: new Map() };
}

/** A Mind event of the given type; the cast is for the fixture only, as in mapper.test.ts. */
function event(type: string, payload: unknown = {}, tick = 100): MindEvent {
  return {
    type,
    payload,
    eventId: `evt-${type}-${tick}`,
    lifeId: LIFE,
    tick,
    day: 1,
    at: AT,
  } as unknown as MindEvent;
}

/** A handler that maps its type to one line whose kind is `label`. */
function labelled(label: string, type: MindEvent['type']) {
  return defineMindHandler(type, (_e, base) => [{ ...base, kind: label } as unknown as SimEvent]);
}

describe('the Mind event handler registry', () => {
  it('lists the built-in handlers in their fixed order', () => {
    expect(MIND_HANDLERS.map((h) => h.type)).toEqual([
      'speech',
      'damage',
      'death',
      'reflex_fired',
      'intent',
      'plan_result',
      'action_outcome',
      'wake',
      'heard_sound',
    ]);
  });

  it('maps a type with no handler to nothing', () => {
    expect(mapMindEvent(event('sleep'), 3, ctx())).toEqual([]);
  });

  it('an extra handler adds its mapping without editing the registry', () => {
    const handlers = [...MIND_HANDLERS, labelled('sleep_seen', 'sleep')];
    expect(mapMindEventWith(handlers, event('sleep'), 9, ctx())).toMatchObject([
      { kind: 'sleep_seen', seq: 9, tick: 100 },
    ]);
  });

  it('an extra handler leaves the built-in mappings as they were', () => {
    const speech = event('speech', {
      from: 'Zack',
      text: 'Jason, come here',
      distance: 3,
      own: false,
    });
    const handlers = [...MIND_HANDLERS, labelled('sleep_seen', 'sleep')];
    expect(mapMindEventWith(handlers, speech, 5, ctx())).toEqual(mapMindEvent(speech, 5, ctx()));
  });

  it('the first handler of a type wins, so the order of the list decides', () => {
    const first = labelled('first', 'sleep');
    const second = labelled('second', 'sleep');
    expect(mapMindEventWith([first, second], event('sleep'), 1, ctx())).toMatchObject([
      { kind: 'first' },
    ]);
    expect(mapMindEventWith([second, first], event('sleep'), 1, ctx())).toMatchObject([
      { kind: 'second' },
    ]);
  });

  it('an empty handler list maps nothing, even a known type', () => {
    const speech = event('speech', { from: 'Zack', text: 'hi', distance: 3, own: false });
    expect(mapMindEventWith([], speech, 1, ctx())).toEqual([]);
  });
});
