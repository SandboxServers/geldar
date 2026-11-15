import { MIND_EVENT_TYPES } from '@geldar/animus/src/link/mind-event.ts';
import { describe, expect, it, vi } from 'vitest';
import type { PlayerEventLog } from '../ports.ts';
import { handleStreamMessage, type StreamContext, streamSubjects } from './stream.ts';

/**
 * The audit types (AN-02a, AN-06): these are WorldEvents the sink projects, and the MCP stream must
 * never hand them to an agent. The stream reads MIND_EVENT_TYPES, so they must stay out of it.
 */
const AUDIT_TYPES = ['roll', 'decision', 'sheet_adopted', 'chunk_visited'];

describe('audit types are hidden from the agent stream (AN-07)', () => {
  it('keeps the audit types out of MIND_EVENT_TYPES', () => {
    for (const type of AUDIT_TYPES) expect(MIND_EVENT_TYPES).not.toContain(type);
  });

  it('keeps the audit types out of the colo stream subjects', () => {
    const subjects = streamSubjects('colo');
    for (const type of AUDIT_TYPES) expect(subjects).not.toContain(`geldar.colo.${type}`);
  });

  it('appends nothing to any life log when a synthetic roll arrives', async () => {
    const append = vi.fn(async () => undefined);
    const log = { append } as unknown as PlayerEventLog;
    const ctx = {
      map: {} as StreamContext['map'],
      log,
      lives: () => ['ag_test_01', 'ag_kestrel_01'],
    } satisfies StreamContext;
    const roll = {
      event_id: 'roll-audit-hidden-1',
      type: 'roll',
      shard: 'colo',
      life_id: 'ag_test_01',
      world_day: 1,
      world_tick: 100,
      source_event_id: 'roll-audit-hidden-1',
      payload: { draw: 'synthetic' },
    };
    await handleStreamMessage(1, roll, ctx, { invalid: 0 });
    expect(append).not.toHaveBeenCalled();
  });
});
