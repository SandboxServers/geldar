import { describe, expect, it } from 'vitest';
import { validateActionRecord, validateReceipt, validateWorldEvent } from '../src/index.ts';

/** An action record from a thought's immediate actions (no intent), with a receipt. */
const actionExample = {
  action_id: 'ac_01HZX3V9Q4M2K8R7T6Y5W4E3D2',
  intent_id: null,
  life_id: 'ag_kestrel_01',
  body_generation: 3,
  sequence: 0,
  source_snapshot_id: 'sn_01HZX3V9Q4M2K8R7T6Y5W4E3D2',
  snapshot_revision: 0,
  expires_tick: 12600,
  kind: 'offer',
  args: { item: 'wheat', count: 4 },
  state: 'completed',
  result: { credits: 4 },
  receipt_id: 'rc_01HZX3V9Q4M2K8R7T6Y5W4E3D3',
};

/** An action record inside an intent, still running, with no result yet. */
const runningExample = {
  ...actionExample,
  action_id: 'ac_01HZX3V9Q4M2K8R7T6Y5W4E3D6',
  intent_id: 'in_01HZX3V9Q4M2K8R7T6Y5W4E3D5',
  sequence: 2,
  kind: 'mine',
  args: { block: 'oak_log', count: 7 },
  state: 'running',
  result: null,
  receipt_id: null,
};

/** The prepared receipt: the intent to consume, written before the economic action takes effect. */
const preparedReceipt = {
  receipt_id: 'rc_01HZX3V9Q4M2K8R7T6Y5W4E3D3',
  action_id: 'ac_01HZX3V9Q4M2K8R7T6Y5W4E3D2',
  life_id: 'ag_kestrel_01',
  kind: 'offer',
  phase: 'prepared',
  at: '2026-11-08T12:00:00Z',
  item: 'wheat',
  count: 4,
};

/** The committed receipt: the final phase of the same offer, carrying the credits. */
const committedReceipt = {
  receipt_id: 'rc_01HZX3V9Q4M2K8R7T6Y5W4E3D4',
  action_id: 'ac_01HZX3V9Q4M2K8R7T6Y5W4E3D2',
  life_id: 'ag_kestrel_01',
  kind: 'offer',
  phase: 'committed',
  at: '2026-11-08T12:00:01Z',
  item: 'wheat',
  count: 4,
  credits: 4,
};

/** An aborted give, with the reason in detail. */
const abortedReceipt = {
  receipt_id: 'rc_01HZX3V9Q4M2K8R7T6Y5W4E3D5',
  action_id: 'ac_01HZX3V9Q4M2K8R7T6Y5W4E3D7',
  life_id: 'ag_kestrel_01',
  kind: 'give',
  phase: 'aborted',
  at: '2026-11-08T12:05:00Z',
  detail: 'recipient left the 3-block radius before the item moved',
};

const receiptExamples = [preparedReceipt, committedReceipt, abortedReceipt];

/** A world event as the sink receives it from NATS. */
const eventExample = {
  source_event_id: 'ev_01HZX3V9Q4M2K8R7T6Y5W4E3D8',
  at: '2026-11-08T12:00:00Z',
  shard: 'baseline',
  world_day: 14,
  world_tick: 12400,
  type: 'trade',
  agent_id: 'ag_kestrel_01',
  thinker_id: 'thinker-a',
  payload: { with: 'ag_pike_01', item: 'wheat', count: 4 },
};

/** A deep copy that a test can break in one place. */
function mutable(example: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(example);
}

describe('validateActionRecord', () => {
  it('accepts an action with no intent and a completed state', () => {
    expect(validateActionRecord(actionExample).ok).toBe(true);
  });

  it('accepts a running action inside an intent with a null receipt', () => {
    expect(validateActionRecord(runningExample).ok).toBe(true);
  });

  it('rejects a state that is not in the enum and names the path', () => {
    const value = mutable(actionExample);
    value.state = 'done';
    const result = validateActionRecord(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.includes('/state'))).toBe(true);
  });

  it('rejects a missing body_generation and names it', () => {
    const value = mutable(actionExample);
    delete value.body_generation;
    const result = validateActionRecord(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.includes("'body_generation'"))).toBe(true);
  });

  it('rejects a negative body_generation', () => {
    const value = mutable(actionExample);
    value.body_generation = -1;
    expect(validateActionRecord(value).ok).toBe(false);
  });

  it('rejects an intent_id without the in_ prefix and names the path', () => {
    const value = mutable(runningExample);
    value.intent_id = 'xx_01HZX3V9Q4M2K8R7T6Y5W4E3D5';
    const result = validateActionRecord(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.includes('/intent_id'))).toBe(true);
  });

  it('rejects a receipt_id without the rc_ prefix and names the path', () => {
    const value = mutable(actionExample);
    value.receipt_id = 'xx_01HZX3V9Q4M2K8R7T6Y5W4E3D3';
    const result = validateActionRecord(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.includes('/receipt_id'))).toBe(true);
  });

  it('rejects an unknown top-level property and names it', () => {
    const value = mutable(actionExample);
    value.priority = 5;
    const result = validateActionRecord(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.includes('priority'))).toBe(true);
  });
});

describe('validateReceipt', () => {
  it.each(receiptExamples)('accepts a $phase receipt', (example) => {
    expect(validateReceipt(example).ok).toBe(true);
  });

  it('rejects phase pending and names the path', () => {
    const value = mutable(preparedReceipt);
    value.phase = 'pending';
    const result = validateReceipt(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.includes('/phase'))).toBe(true);
  });

  it('rejects detail longer than 256 characters', () => {
    const value = mutable(abortedReceipt);
    value.detail = 'x'.repeat(257);
    expect(validateReceipt(value).ok).toBe(false);
  });

  it('rejects an unknown top-level property and names it', () => {
    const value = mutable(committedReceipt);
    value.memo = 'thanks';
    const result = validateReceipt(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.includes('memo'))).toBe(true);
  });
});

describe('validateWorldEvent', () => {
  it('accepts the trade example', () => {
    expect(validateWorldEvent(eventExample).ok).toBe(true);
  });

  it('accepts an event with no agent_id or thinker_id', () => {
    const value = mutable(eventExample);
    delete value.agent_id;
    delete value.thinker_id;
    value.type = 'server_tps';
    expect(validateWorldEvent(value).ok).toBe(true);
  });

  it('rejects a source_event_id without the ev_ prefix and names the path', () => {
    const value = mutable(eventExample);
    value.source_event_id = 'xx_01HZX3V9Q4M2K8R7T6Y5W4E3D8';
    const result = validateWorldEvent(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.includes('/source_event_id'))).toBe(true);
  });

  it('rejects an unknown top-level property and names it', () => {
    const value = mutable(eventExample);
    value.subject = 'geldar.baseline.trade';
    const result = validateWorldEvent(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.includes('subject'))).toBe(true);
  });
});
