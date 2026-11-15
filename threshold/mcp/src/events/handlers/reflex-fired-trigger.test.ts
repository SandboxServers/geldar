import type { SimEvent } from '@geldar/mcp-mock';
import type { MindEvent } from '@geldar/player-core/src/ports/body.ts';
import { describe, expect, it } from 'vitest';
import { toPlayerEvents } from '../present.ts';
import { reflexFiredHandler } from './reflex-fired.ts';
import type { EventBase, MapContext } from './types.ts';

const base: EventBase = { seq: 1, tick: 1, atMs: 0, wakeOn: null };
const ctx = {} as unknown as MapContext;

const reflexEvent = (payload: Record<string, unknown>): MindEvent =>
  ({ type: 'reflex_fired', payload }) as unknown as MindEvent;

describe('reflex_fired carries the Body trigger to the presenter (0213)', () => {
  it('passes a hostile trigger through, so the line names the kind and distance', () => {
    const trigger = { cause: 'hostile', hostile: 'zombie', distance: 5 };
    const [mapped] = reflexFiredHandler.map(
      reflexEvent({ name: 'panic_burrow', result: 'handled', trigger }),
      base,
      ctx,
    );
    expect(mapped).toMatchObject({ kind: 'reflex', trigger });
    expect(toPlayerEvents([mapped as SimEvent]).map((e) => e.text)).toEqual([
      'Reflex panic_burrow: a zombie was 5 blocks away, so you dug in.',
    ]);
  });

  it('carries no trigger when the event has none (old events keep the fixed line)', () => {
    const [mapped] = reflexFiredHandler.map(
      reflexEvent({ name: 'panic_burrow', result: 'handled' }),
      base,
      ctx,
    );
    expect(mapped).not.toHaveProperty('trigger');
    expect(toPlayerEvents([mapped as SimEvent]).map((e) => e.text)).toEqual([
      'Reflex panic_burrow: a threat was close, you dug in.',
    ]);
  });
});
