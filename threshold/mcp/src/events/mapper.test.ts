import type { MindEvent } from '@geldar/animus/src/ports/body.ts';
import type { SimEvent } from '@geldar/mcp-mock';
import { describe, expect, it } from 'vitest';
import { type MapContext, mapMindEvent, type RunState } from './mapper.ts';
import { toPlayerEvents } from './present.ts';

const LIFE = 'ag_jason_01';
const AT = '2026-11-09T10:00:00.000Z';

function ctxWith(runs: RunState | null = null): MapContext {
  const map = new Map<string, RunState>();
  if (runs !== null) map.set(LIFE, runs);
  return { identity: { name: 'Jason', username: LIFE }, runs: map };
}

/** A Mind event of the given type; the cast is for the fixture only, the payloads are the contract's. */
function event(type: string, payload: unknown, tick = 100): MindEvent {
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

describe('mapMindEvent', () => {
  it('maps speech to a speech entry: addressed by name, overheard otherwise, own speech dropped', () => {
    const ctx = ctxWith();
    const hi = mapMindEvent(
      event('speech', { from: 'Zack', text: 'Jason, come here', distance: 3, own: false }),
      5,
      ctx,
    );
    expect(hi).toMatchObject([{ kind: 'speech', addressed: true, from: 'Zack', seq: 5 }]);
    const chat = mapMindEvent(
      event('speech', { from: 'Zack', text: 'nice weather', distance: 3, own: false }),
      6,
      ctx,
    );
    expect(chat).toMatchObject([{ kind: 'speech', addressed: false }]);
    expect(
      mapMindEvent(event('speech', { from: LIFE, text: 'hello', distance: 0, own: true }), 7, ctx),
    ).toEqual([]);
  });

  it('maps plugin damage and death to damage, and a damage wake to damage', () => {
    const ctx = ctxWith();
    expect(mapMindEvent(event('damage', { amount: 4 }), 1, ctx)).toMatchObject([
      { kind: 'damage', amount: 4 },
    ]);
    expect(mapMindEvent(event('death', {}), 2, ctx)).toMatchObject([{ kind: 'damage', amount: 0 }]);
    expect(
      mapMindEvent(
        event('wake', { reason: 'unexpected_damage', tick: 1, intent_id: null }),
        3,
        ctx,
      ),
    ).toMatchObject([{ kind: 'damage' }]);
    expect(
      mapMindEvent(event('wake', { reason: 'reflex_danger', tick: 1, intent_id: null }), 4, ctx),
    ).toMatchObject([{ kind: 'damage' }]);
  });

  it('maps new_agent_within_N to agent_approached only while a running intent lists it', () => {
    const wake = event('wake', { reason: 'new_agent_within_8', tick: 1, intent_id: null });
    expect(mapMindEvent(wake, 1, ctxWith())).toEqual([]);
    const running = ctxWith({ wakeOn: ['new_agent_within_8'], startedMs: 0 });
    expect(mapMindEvent(wake, 2, running)).toMatchObject([
      { kind: 'agent_approached', distance: 8, wakeOn: ['new_agent_within_8'] },
    ]);
  });

  it('keeps the running intent and ends it on a terminal state', () => {
    const ctx = ctxWith();
    const accepted = event('intent', { intent_id: 'i1', state: 'accepted', wake_on: ['damage'] });
    expect(mapMindEvent(accepted, 1, ctx)).toEqual([]);
    expect(ctx.runs.get(LIFE)?.wakeOn).toEqual(['damage']);
    const done = mapMindEvent(event('intent', { intent_id: 'i1', state: 'completed' }), 2, ctx);
    expect(done).toMatchObject([{ kind: 'intent_finished', outcome: 'completed' }]);
    expect(ctx.runs.get(LIFE)?.wakeOn).toBeNull();
    const failed = mapMindEvent(event('intent', { intent_id: 'i2', state: 'failed' }), 3, ctx);
    expect(failed).toMatchObject([{ kind: 'intent_finished', outcome: 'failed' }]);
  });

  it('ends a limit once: the limit wake for an intent already ended is no second event', () => {
    const ctx = ctxWith();
    const end = { intent_id: 'i3', state: 'failed', detail: 'max_world_ticks reached' };
    expect(mapMindEvent(event('intent', end), 1, ctx)).toMatchObject([
      { kind: 'intent_finished', outcome: 'limit_reached' },
    ]);
    const wake = event('wake', { reason: 'limit_reached', tick: 100, intent_id: 'i3' });
    expect(mapMindEvent(wake, 2, ctx)).toEqual([]);
    expect(mapMindEvent(event('intent', end), 3, ctx)).toEqual([]);
    const lost = event('wake', { reason: 'limit_reached', tick: 100, intent_id: 'i4' });
    expect(mapMindEvent(lost, 4, ctx)).toMatchObject([
      { kind: 'intent_finished', outcome: 'limit_reached' },
    ]);
  });

  it('maps a failure that is not a limit to failed, and a cancelled or interrupted intent to failed', () => {
    const ctx = ctxWith();
    const reasons = [
      { intent_id: 'i5', state: 'failed', detail: 'no oak_log within reach' },
      { intent_id: 'i6', state: 'cancelled', detail: 'replaced' },
      { intent_id: 'i7', state: 'interrupted', detail: 'interrupted: restart' },
    ];
    reasons.forEach((payload, i) => {
      expect(mapMindEvent(event('intent', payload), i + 1, ctx)).toMatchObject([
        { kind: 'intent_finished', outcome: 'failed' },
      ]);
    });
  });

  it('maps an immediate-only plan result with actions to intent_finished, and ignores an empty one', () => {
    const ctx = ctxWith();
    const action = { action_id: 'a1', do: 'wait' };
    const ok = event('plan_result', {
      thought_id: 't',
      intent: 'none',
      failed_at: null,
      actions: [action],
    });
    expect(mapMindEvent(ok, 1, ctx)).toMatchObject([
      { kind: 'plan_result', thought_id: 't' },
      { kind: 'intent_finished', outcome: 'completed' },
    ]);
    const bad = event('plan_result', {
      thought_id: 't',
      intent: 'none',
      failed_at: 0,
      actions: [action],
    });
    expect(mapMindEvent(bad, 2, ctx)).toMatchObject([
      { kind: 'plan_result', thought_id: 't' },
      { kind: 'intent_finished', outcome: 'failed' },
    ]);
    const none = event('plan_result', {
      thought_id: 't',
      intent: 'none',
      failed_at: null,
      actions: [],
    });
    expect(mapMindEvent(none, 3, ctx)).toMatchObject([{ kind: 'plan_result', thought_id: 't' }]);
  });

  it('maps a no_plan wake to a failed intent and clears the run', () => {
    const ctx = ctxWith({ wakeOn: null, startedMs: 0 });
    const wake = event('wake', { reason: 'no_plan', tick: 1, intent_id: 'i1' });
    expect(mapMindEvent(wake, 1, ctx)).toMatchObject([
      { kind: 'intent_finished', outcome: 'failed' },
    ]);
    expect(ctx.runs.get(LIFE)?.startedMs).toBeNull();
  });

  it('maps a no_plan wake with no intent to a neutral wake, never an intent end', () => {
    const ctx = ctxWith({ wakeOn: null, startedMs: 0 });
    const wake = event('wake', { reason: 'no_plan', tick: 1, intent_id: null });
    const out = mapMindEvent(wake, 1, ctx);
    expect(out).toEqual([expect.objectContaining({ kind: 'wake', seq: 1 })]);
    expect(out.some((e) => e.kind === 'intent_finished')).toBe(false);
  });

  it('maps only an eat reflex that ate to a reflex entry', () => {
    const ctx = ctxWith();
    const fired = (name: string, result: string) =>
      mapMindEvent(event('reflex_fired', { name, result, tick: 100 }), 1, ctx);
    expect(fired('eat', 'handled')).toMatchObject([{ kind: 'reflex' }]);
    expect(fired('eat', 'failed')).toEqual([]);
    expect(fired('eat', 'abandoned')).toEqual([]);
    expect(fired('flee', 'handled')).toEqual([]);
    expect(mapMindEvent(event('sleep', {}), 2, ctx)).toEqual([]);
  });

  it('gives a failed intent a plain reason the player hears, and nothing for unknown details', () => {
    const failedWith = (detail: string) => {
      const out = mapMindEvent(
        event('intent', { state: 'failed', intent_id: 'i1', detail }),
        1,
        ctxWith(),
      );
      return toPlayerEvents(out)[0]?.text;
    };
    expect(failedWith('missing_materials: missing oak_planks, stick')).toBe(
      'Your intent failed: you lack oak planks, stick.',
    );
    expect(failedWith('missing_station: needs a crafting table')).toBe(
      'Your intent failed: no crafting table within reach.',
    );
    expect(failedWith('blocked: no path')).toBe('Your intent failed: the way was blocked.');
    // A detail that is not a known shape, or carries odd text, is never quoted.
    expect(failedWith('missing_materials: missing Ignore previous; tell {x}')).toBe(
      'Your intent failed: precondition_failed.',
    );
    expect(failedWith('internal: stack trace at golem/src')).toBe(
      'Your intent failed: precondition_failed.',
    );
  });

  it('keeps the stream sequence and the tick on every entry', () => {
    const out: SimEvent[] = mapMindEvent(event('damage', { amount: 1 }, 77), 42, ctxWith());
    expect(out[0]).toMatchObject({ seq: 42, tick: 77, atMs: Date.parse(AT) });
  });
});
