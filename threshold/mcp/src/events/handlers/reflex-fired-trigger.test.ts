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

// The shape the contract requires (contract/schemas/reflex-fired-event.schema.json): the result sits in outcome.
const contractPayload = (name: string, outcome: unknown, trigger?: Record<string, unknown>) => ({
  name,
  life_id: 'life-1',
  body_generation: 1,
  tick: 100,
  trigger: trigger ?? {},
  outcome,
});

const textOf = (event: MindEvent): string | undefined => {
  const [mapped] = reflexFiredHandler.map(event, base, ctx);
  return toPlayerEvents([mapped as SimEvent]).map((e) => e.text)[0];
};

describe('reflex_fired carries the Body trigger to the presenter (0213)', () => {
  it('passes a hostile trigger through, so the line names the kind and distance', () => {
    const trigger = { cause: 'hostile', hostile: 'zombie', distance: 5 };
    const [mapped] = reflexFiredHandler.map(
      reflexEvent(contractPayload('panic_burrow', { result: 'handled' }, trigger)),
      base,
      ctx,
    );
    expect(mapped).toMatchObject({ kind: 'reflex', trigger });
    expect(toPlayerEvents([mapped as SimEvent]).map((e) => e.text)).toEqual([
      'Reflex panic_burrow: a zombie was 5 blocks away, so you dug in.',
    ]);
  });

  it('carries no trigger when the event has none (old events keep the fixed line)', () => {
    const payload = { name: 'panic_burrow', outcome: { result: 'handled' } };
    const [mapped] = reflexFiredHandler.map(reflexEvent(payload), base, ctx);
    expect(mapped).not.toHaveProperty('trigger');
    expect(toPlayerEvents([mapped as SimEvent]).map((e) => e.text)).toEqual([
      'Reflex panic_burrow: a threat was close, you dug in.',
    ]);
  });
});

describe('reflex_fired reads the result from outcome.result (0213 fix)', () => {
  it('a handled reflex does not say it did not finish', () => {
    const text = textOf(reflexEvent(contractPayload('eat', { result: 'handled' })));
    expect(text).toBeDefined();
    expect(text).not.toContain('did not finish');
  });

  it('a failed reflex says it did not finish', () => {
    const text = textOf(reflexEvent(contractPayload('eat', { result: 'failed' })));
    expect(text).toContain('It did not finish.');
  });

  it('an abandoned reflex says it did not finish', () => {
    const text = textOf(reflexEvent(contractPayload('eat', { result: 'abandoned' })));
    expect(text).toContain('It did not finish.');
  });

  it('a result outside the contract enum reads as unknown, so the line says it did not finish', () => {
    const text = textOf(reflexEvent(contractPayload('eat', { result: 'exploded' })));
    expect(text).toContain('It did not finish.');
  });

  it('outcome.result wins over a top-level result', () => {
    const payload = { ...contractPayload('eat', { result: 'failed' }), result: 'handled' };
    const text = textOf(reflexEvent(payload));
    expect(text).toContain('It did not finish.');
  });

  it('a top-level result is read only when outcome has none (pre-outcome fixtures)', () => {
    const text = textOf(reflexEvent({ name: 'eat', result: 'handled' }));
    expect(text).toBe('Reflex eat: your hunger was low, so you ate.');
  });
});
