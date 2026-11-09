import type { ActionRecord } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { MemorySink } from '../body/records.ts';
import { DIGEST_SIZE, RecentEvents } from './recent-events.ts';

function action(state: ActionRecord['state'], id = 'ac_1'): ActionRecord {
  return {
    action_id: id,
    intent_id: null,
    life_id: 'ag_adam_01',
    body_generation: 1,
    sequence: 0,
    source_snapshot_id: 'sn_x',
    snapshot_revision: 1,
    expires_tick: 10,
    kind: 'eat',
    args: {},
    state,
    result: state === 'failed' ? { reason: 'not_possible', message: 'not hungry' } : null,
  } as unknown as ActionRecord;
}

describe('RecentEvents', () => {
  it('passes every record to the inner sink and digests the ends', () => {
    const inner = new MemorySink();
    const events = new RecentEvents(inner);
    events.actionChanged(action('running'));
    events.actionChanged(action('failed'));
    events.intentChanged({
      intentId: 'in_1',
      lifeId: 'ag_adam_01',
      bodyGeneration: 1,
      state: 'running',
      tick: 1,
    });
    events.intentChanged({
      intentId: 'in_1',
      lifeId: 'ag_adam_01',
      bodyGeneration: 1,
      state: 'completed',
      tick: 9,
    });
    events.reflexFired({
      name: 'eat',
      lifeId: 'ag_adam_01',
      bodyGeneration: 1,
      tick: 5,
      trigger: {},
      outcome: { result: 'handled' },
    });
    events.wake({
      reason: 'directly_addressed',
      tick: 6,
      intentId: null,
      detail: 'addressed by pike',
    });
    expect(inner.actions).toHaveLength(2);
    expect(inner.intents).toHaveLength(2);
    expect(inner.reflexes).toHaveLength(1);
    expect(inner.wakes).toHaveLength(1);
    const drained = events.drainEvents();
    expect(drained.map((e) => e.type)).toEqual([
      'action_ended',
      'intent_ended',
      'reflex_fired',
      'wake',
    ]);
    expect(drained[0]).toMatchObject({ reason: 'not_possible', detail: 'not hungry' });
  });

  it('drainEvents clears the digest', () => {
    const events = new RecentEvents(new MemorySink());
    events.actionChanged(action('completed'));
    expect(events.drainEvents()).toHaveLength(1);
    expect(events.drainEvents()).toEqual([]);
  });

  it('notes health drops of 2 or more only', () => {
    const events = new RecentEvents(new MemorySink());
    events.noteHealth(20, 1);
    events.noteHealth(19, 2);
    events.noteHealth(17, 3);
    events.noteHealth(20, 4);
    events.noteHealth(18, 5);
    expect(events.drainEvents()).toEqual([
      { type: 'health_drop', from: 19, to: 17, tick: 3 },
      { type: 'health_drop', from: 20, to: 18, tick: 5 },
    ]);
  });

  it('keeps at most 100 entries, dropping the oldest', () => {
    const events = new RecentEvents(new MemorySink());
    for (let i = 0; i < DIGEST_SIZE + 25; i++) events.actionChanged(action('completed', `ac_${i}`));
    const drained = events.drainEvents();
    expect(drained).toHaveLength(DIGEST_SIZE);
    expect(drained[0]).toMatchObject({ action_id: 'ac_25' });
  });
});
