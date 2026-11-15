import { describe, expect, it } from 'vitest';
import { validateTurnRecordPayload, validateWorldEvent } from '../src/index.ts';

const HASH = 'a'.repeat(64);

const record = {
  turn_id: 'tn_01HZX3V9Q4M2K8R7T6Y5W4E3D5',
  life_id: 'ag_kestrel_01',
  harness: 'claude',
  model: 'claude-sonnet-5.5',
  template_version: HASH,
  wake_reason: 'directly_addressed',
  world_day: 3,
  world_tick: 1200,
  model_input: 'You are a kit Mind.',
  raw_output: 'I will walk to the tree.',
  tokens_in: 1200,
  tokens_out: 80,
  usage_source: 'provider',
  latency_ms: 2100,
  context_tokens: 1280,
  context_window: 200000,
};

/** Returns the record with one property replaced (or removed when the value is undefined). */
function with_(key: string, value: unknown): Record<string, unknown> {
  const next: Record<string, unknown> = { ...record, [key]: value };
  if (value === undefined) delete next[key];
  return next;
}

describe('turn_record payload (GX-05a, decision 0185)', () => {
  it('accepts a complete record, with and without the optional credits', () => {
    expect(validateTurnRecordPayload(record).ok).toBe(true);
    expect(validateTurnRecordPayload({ ...record, credits: 12 }).ok).toBe(true);
    expect(validateTurnRecordPayload({ ...record, usage_source: 'estimated' }).ok).toBe(true);
  });

  it('accepts the length caps exactly and refuses one character over', () => {
    const cap = 'x'.repeat(32768);
    expect(validateTurnRecordPayload(with_('model_input', cap)).ok).toBe(true);
    expect(validateTurnRecordPayload(with_('raw_output', cap)).ok).toBe(true);
    expect(validateTurnRecordPayload(with_('model_input', `${cap}x`)).ok).toBe(false);
    expect(validateTurnRecordPayload(with_('raw_output', `${cap}x`)).ok).toBe(false);
  });

  it('refuses a missing required field', () => {
    for (const key of Object.keys(record)) {
      expect(validateTurnRecordPayload(with_(key, undefined)).ok, key).toBe(false);
    }
  });

  it('refuses an unknown property', () => {
    expect(validateTurnRecordPayload({ ...record, owner_id: 'o_1' }).ok).toBe(false);
  });

  it('refuses ids and names outside their patterns', () => {
    expect(validateTurnRecordPayload(with_('turn_id', 'tn_short')).ok).toBe(false);
    expect(validateTurnRecordPayload(with_('life_id', 'kestrel')).ok).toBe(false);
    expect(validateTurnRecordPayload(with_('harness', 'Claude')).ok).toBe(false);
    expect(validateTurnRecordPayload(with_('model', 'bad model')).ok).toBe(false);
    expect(validateTurnRecordPayload(with_('model', '')).ok).toBe(false);
    expect(validateTurnRecordPayload(with_('wake_reason', 'Directly Addressed')).ok).toBe(false);
  });

  it('requires the template version to be 64 lowercase hex characters', () => {
    expect(validateTurnRecordPayload(with_('template_version', 'a'.repeat(63))).ok).toBe(false);
    expect(validateTurnRecordPayload(with_('template_version', 'a'.repeat(65))).ok).toBe(false);
    expect(validateTurnRecordPayload(with_('template_version', 'A'.repeat(64))).ok).toBe(false);
    expect(validateTurnRecordPayload(with_('template_version', 'g'.repeat(64))).ok).toBe(false);
  });

  it('refuses negative or oversized numeric fields, at each bound', () => {
    const numeric = [
      'world_day',
      'tokens_in',
      'tokens_out',
      'latency_ms',
      'context_tokens',
      'context_window',
      'credits',
    ];
    for (const key of numeric) {
      expect(validateTurnRecordPayload(with_(key, -1)).ok, `${key} -1`).toBe(false);
    }
    expect(validateTurnRecordPayload(with_('tokens_in', 100000001)).ok).toBe(false);
    expect(validateTurnRecordPayload(with_('context_window', 0)).ok).toBe(false);
    expect(validateTurnRecordPayload(with_('tokens_in', 0)).ok).toBe(true);
    expect(validateTurnRecordPayload(with_('context_window', 1)).ok).toBe(true);
  });

  it('accepts only the two usage sources', () => {
    expect(validateTurnRecordPayload(with_('usage_source', 'measured')).ok).toBe(false);
  });

  it('is carried by a WorldEvent of type turn_record', () => {
    const event = {
      source_event_id: 'ev_01HZX3V9Q4M2K8R7T6Y5W4E3D5',
      at: '2026-11-14T10:00:00Z',
      shard: 'phase0',
      world_day: 3,
      world_tick: 1200,
      type: 'turn_record',
      agent_id: 'ag_kestrel_01',
      harness: 'claude',
      model: 'claude-sonnet-5.5',
      payload: record,
    };
    expect(validateWorldEvent(event).ok).toBe(true);
  });
});
