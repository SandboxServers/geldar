import { validateWorldEvent } from '@geldar/contract';
import { describe, expect, it, vi } from 'vitest';
import type { PlayerEventLog } from '../ports.ts';
import { handleStreamMessage, type StreamContext, streamSubjects } from './stream.ts';

/**
 * The audit types (AN-02a, AN-06): these are WorldEvents the sink projects, and the MCP stream must
 * never hand them to an agent. The stream's subjects come from the Mind event list, so they must
 * stay out of it.
 */
const AUDIT_TYPES = ['roll', 'decision', 'sheet_adopted', 'chunk_visited'];

/**
 * A local copy of the Mind event types (player-core's MIND_EVENT_TYPES, copied when animus was
 * removed). Kept literal so a leaked audit type fails this test without importing another package.
 */
const MIND_EVENT_TYPES: readonly string[] = [
  'wake',
  'intent',
  'action',
  'plan_result',
  'action_outcome',
  'reflex_fired',
  'speech',
  'damage',
  'death',
  'sleep',
  'heard_sound',
  'observation',
];

/** A valid WorldEvent envelope (the contract's field set, a real ev_ ULID) of one type. */
function envelope(type: string) {
  return {
    source_event_id: 'ev_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    at: '2026-11-14T00:00:00.000Z',
    shard: 'colo',
    world_day: 1,
    world_tick: 100,
    type,
    agent_id: 'ag_test_01',
    payload: {},
  };
}

/** A stream context with two lives; `append` is the spy the assertions read. */
function contextWith(append: (lifeId: string, event: unknown) => Promise<void>): StreamContext {
  const log = { append } as unknown as PlayerEventLog;
  return {
    // The mapper reads map.runs for a mind event; an empty run table is enough for these envelopes.
    map: { runs: new Map() } as unknown as StreamContext['map'],
    log,
    lives: () => ['ag_test_01', 'ag_kestrel_01'],
  } satisfies StreamContext;
}

describe('audit types are hidden from the agent stream (AN-07)', () => {
  it('keeps the audit types out of MIND_EVENT_TYPES', () => {
    for (const type of AUDIT_TYPES) expect(MIND_EVENT_TYPES).not.toContain(type);
  });

  it('keeps the audit types out of the colo stream subjects', () => {
    const subjects = streamSubjects('colo');
    for (const type of AUDIT_TYPES) expect(subjects).not.toContain(`geldar.colo.${type}`);
  });

  it('appends nothing to any life log when a valid audit event arrives', async () => {
    const append = vi.fn(async (_lifeId: string, _event: unknown) => undefined);
    for (const type of AUDIT_TYPES) {
      const event = envelope(type);
      // The envelope is a real WorldEvent, so the stream's envelope check passes and only the type decides.
      expect(validateWorldEvent(event).ok).toBe(true);
      const counters = { invalid: 0 };
      await handleStreamMessage(1, event, contextWith(append), counters);
      expect(counters.invalid).toBe(0);
    }
    expect(append).not.toHaveBeenCalled();
  });

  it('appends a valid mind event with the same envelope (positive control)', async () => {
    // Proves the envelope and the append path work, so the test above cannot pass vacuously.
    const append = vi.fn(async (_lifeId: string, _event: unknown) => undefined);
    const counters = { invalid: 0 };
    await handleStreamMessage(2, envelope('death'), contextWith(append), counters);
    expect(counters.invalid).toBe(0);
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0]?.[0]).toBe('ag_test_01');
  });
});
