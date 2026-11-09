import type { WorldEvent } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { handleBatch, type SinkMessage } from './consumer.ts';
import {
  ACTION_ID,
  actionEvent,
  eventOf,
  INTENT_FIELDS,
  INTENT_ID,
  intentEvent,
  MemoryProjectionStore,
  RECEIPT_A,
  RECEIPT_B,
  receiptEvent,
} from './projection.fakes.ts';
import { ProjectionRejectedError, projectEvent } from './projection.ts';

async function project(store: MemoryProjectionStore, events: WorldEvent[]): Promise<void> {
  for (const event of events) await projectEvent(event, store);
}

describe('intents', () => {
  it('moves forward and records start and end', async () => {
    const store = new MemoryProjectionStore();
    await project(store, [
      intentEvent('accepted', 10),
      intentEvent('running', 12),
      intentEvent('completed', 50, 'done'),
    ]);
    expect(store.intents.get(INTENT_ID)).toMatchObject({
      state: 'completed',
      started_tick: 10,
      ended_tick: 50,
      end_reason: 'done',
    });
  });

  it('converges under reorder and redelivery', async () => {
    const forward = new MemoryProjectionStore();
    await project(forward, [
      intentEvent('accepted', 10),
      intentEvent('running', 12),
      intentEvent('failed', 50, 'blocked'),
    ]);
    const scrambled = new MemoryProjectionStore();
    await project(scrambled, [
      intentEvent('failed', 50, 'blocked'),
      intentEvent('accepted', 10),
      intentEvent('failed', 50, 'blocked'),
      intentEvent('running', 12),
      intentEvent('accepted', 10),
    ]);
    expect(scrambled.intents.get(INTENT_ID)).toEqual(forward.intents.get(INTENT_ID));
    expect(scrambled.intents.get(INTENT_ID)?.state).toBe('failed');
  });

  it('never moves back and does not write a repeat', async () => {
    const store = new MemoryProjectionStore();
    await project(store, [intentEvent('running', 12)]);
    const writes = store.writes;
    await project(store, [intentEvent('running', 12), intentEvent('accepted', 12)]);
    expect(store.writes).toBe(writes);
    expect(store.intents.get(INTENT_ID)?.state).toBe('running');
  });

  it('keeps the first final state', async () => {
    const store = new MemoryProjectionStore();
    await project(store, [intentEvent('cancelled', 20, 'replaced'), intentEvent('completed', 21)]);
    expect(store.intents.get(INTENT_ID)).toMatchObject({
      state: 'cancelled',
      end_reason: 'replaced',
    });
  });

  it('leaves paused to the events table', async () => {
    const store = new MemoryProjectionStore();
    await project(store, [intentEvent('paused', 5)]);
    expect(store.intents.size).toBe(0);
  });

  it('stores an interrupted intent as cancelled with an interrupted: end reason', async () => {
    const store = new MemoryProjectionStore();
    await project(store, [
      intentEvent('accepted', 4),
      intentEvent('running', 5),
      intentEvent('interrupted', 6, 'woke the Mind'),
    ]);
    expect(store.intents.get(INTENT_ID)).toMatchObject({
      state: 'cancelled',
      ended_tick: 6,
      end_reason: 'interrupted: woke the Mind',
    });
    // With no detail the reason is still marked, and a later final state does not replace it.
    const bare = new MemoryProjectionStore();
    await project(bare, [intentEvent('interrupted', 6), intentEvent('completed', 9)]);
    expect(bare.intents.get(INTENT_ID)).toMatchObject({
      state: 'cancelled',
      end_reason: 'interrupted:',
    });
  });

  it('treats a higher body generation as a new run of the same intent', async () => {
    const store = new MemoryProjectionStore();
    await project(store, [
      intentEvent('accepted', 4),
      intentEvent('running', 5),
      intentEvent('interrupted', 6, 'restart'),
      intentEvent('running', 8, undefined, { body_generation: 2 }),
    ]);
    expect(store.intents.get(INTENT_ID)).toMatchObject({
      state: 'running',
      body_generation: 2,
      ended_tick: null,
      end_reason: null,
    });
    await project(store, [intentEvent('completed', 30, 'done', { body_generation: 2 })]);
    expect(store.intents.get(INTENT_ID)).toMatchObject({
      state: 'completed',
      body_generation: 2,
      ended_tick: 30,
      end_reason: 'done',
    });
    // The old generation's events arriving late change nothing.
    await project(store, [intentEvent('interrupted', 6, 'restart'), intentEvent('running', 5)]);
    expect(store.intents.get(INTENT_ID)).toMatchObject({ state: 'completed', body_generation: 2 });
    // The new run resumes at generation 2 even when only the final event arrives.
    const direct = new MemoryProjectionStore();
    await project(direct, [
      intentEvent('interrupted', 6, 'restart'),
      intentEvent('completed', 30, undefined, { body_generation: 2 }),
    ]);
    expect(direct.intents.get(INTENT_ID)).toMatchObject({ state: 'completed', ended_tick: 30 });
  });

  it('ignores a late older-generation interrupt while the newer generation is running', async () => {
    const store = new MemoryProjectionStore();
    await project(store, [
      intentEvent('accepted', 4),
      intentEvent('running', 8, undefined, { body_generation: 2 }),
    ]);
    await project(store, [intentEvent('interrupted', 6, 'restart')]);
    const row = store.intents.get(INTENT_ID);
    expect(row).toMatchObject({ state: 'running', body_generation: 2, ended_tick: null });
    expect(row?.end_reason).toBeNull();
  });

  it('fills the intent columns from the accepted event, also when it arrives late', async () => {
    const inOrder = new MemoryProjectionStore();
    await project(inOrder, [
      intentEvent('accepted', 4, undefined, INTENT_FIELDS),
      intentEvent('running', 5),
      intentEvent('completed', 9, 'done'),
    ]);
    expect(inOrder.intents.get(INTENT_ID)).toMatchObject({
      ...INTENT_FIELDS,
      checkpoint: null,
      thought_id: null,
    });
    const late = new MemoryProjectionStore();
    await project(late, [
      intentEvent('completed', 9, 'done'),
      intentEvent('accepted', 4, undefined, INTENT_FIELDS),
    ]);
    expect(late.intents.get(INTENT_ID)).toEqual(inOrder.intents.get(INTENT_ID));
  });
});

describe('actions', () => {
  it('converges when completed arrives before accepted and running', async () => {
    const store = new MemoryProjectionStore();
    await project(store, [
      actionEvent('completed', RECEIPT_A),
      actionEvent('accepted'),
      actionEvent('running'),
      actionEvent('completed', RECEIPT_A),
    ]);
    expect(store.actions.get(ACTION_ID)).toMatchObject({
      state: 'completed',
      receipt_id: RECEIPT_A,
    });
    expect(store.writes).toBe(1);
  });

  it('moves forward one state at a time', async () => {
    const store = new MemoryProjectionStore();
    await project(store, [actionEvent('accepted'), actionEvent('running')]);
    expect(store.actions.get(ACTION_ID)?.state).toBe('running');
    expect(store.writes).toBe(2);
  });
});

describe('receipts', () => {
  it('stores a receipt once however often it is delivered', async () => {
    const store = new MemoryProjectionStore();
    await project(store, [
      receiptEvent(RECEIPT_A, 'committed'),
      receiptEvent(RECEIPT_A, 'committed'),
    ]);
    expect(store.receipts).toHaveLength(1);
  });

  it('does not take a same-id receipt of another phase for a redelivery', async () => {
    const store = new MemoryProjectionStore();
    await project(store, [receiptEvent(RECEIPT_A, 'prepared')]);
    const error = await projectEvent(receiptEvent(RECEIPT_A, 'committed'), store).catch((e) => e);
    expect(error).toBeInstanceOf(ProjectionRejectedError);
    expect(error.message).toContain('already stored as a prepared receipt');
    expect(store.receipts).toHaveLength(1);
  });

  it('allows a prepared receipt before the final one', async () => {
    const store = new MemoryProjectionStore();
    await project(store, [
      receiptEvent(RECEIPT_B, 'prepared'),
      receiptEvent(RECEIPT_A, 'committed'),
    ]);
    expect(store.receipts.map((r) => r.phase)).toEqual(['prepared', 'committed']);
  });

  it.each([
    ['committed', 'aborted'],
    ['aborted', 'committed'],
    ['committed', 'committed'],
  ])('rejects a second final receipt (%s then %s)', async (first, second) => {
    const store = new MemoryProjectionStore();
    await project(store, [receiptEvent(RECEIPT_A, first)]);
    const error = await projectEvent(receiptEvent(RECEIPT_B, second), store).catch((e) => e);
    expect(error).toBeInstanceOf(ProjectionRejectedError);
    expect(error.code).toBe('23505');
    expect(error.message).toContain('one final receipt per action');
    expect(store.receipts).toHaveLength(1);
  });

  it('dead-letters the second final receipt with the reason', async () => {
    const store = new MemoryProjectionStore();
    const writer = {
      async insertBatch(events: readonly WorldEvent[]) {
        for (const event of events) await projectEvent(event, store);
      },
    };
    const dead: string[] = [];
    const acked: string[] = [];
    const message = (event: WorldEvent): SinkMessage => ({
      subject: `geldar.${event.shard}.${event.type}`,
      data: new TextEncoder().encode(JSON.stringify(event)),
      deliveryCount: 1,
      ack: () => void acked.push(event.source_event_id),
      nak: () => {
        throw new Error('should not nak');
      },
    });
    const first = receiptEvent(RECEIPT_A, 'committed');
    const second = {
      ...receiptEvent(RECEIPT_B, 'aborted'),
      source_event_id: 'ev_01HZX3V9Q4M2K8R7T6Y5W4E999',
    };
    await handleBatch([message(first), message(second)], {
      writer,
      publishDlq: async (subject, body) => void dead.push(`${subject} ${body}`),
      log: () => undefined,
    });
    expect(acked).toHaveLength(2);
    expect(dead).toHaveLength(1);
    expect(dead[0]).toContain('geldar.phase0.dlq');
    expect(dead[0]).toContain('one final receipt per action');
    expect(store.receipts.map((r) => r.receipt_id)).toEqual([RECEIPT_A]);
  });
});

describe('other events', () => {
  it('does nothing for a type with no table', async () => {
    const store = new MemoryProjectionStore();
    await project(store, [eventOf('reflex_fired', { name: 'eat' }), eventOf('wake', {})]);
    expect(store.writes).toBe(0);
  });

  it('rejects an invalid payload with a permanent code', async () => {
    const store = new MemoryProjectionStore();
    const error = await projectEvent(eventOf('intent', { state: 'running' }), store).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(ProjectionRejectedError);
    expect(error.code).toBe('23514');
    expect(store.writes).toBe(0);
  });
});
