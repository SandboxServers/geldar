import { describe, expect, it } from 'vitest';
import { validateWorldEvent } from '../src/index.ts';

const base = {
  source_event_id: 'ev_01HZX3V9Q4M2K8R7T6Y5W4E3D8',
  at: '2026-11-14T12:00:00Z',
  shard: 'phase0',
  world_day: 3,
  world_tick: 72000,
  type: 'sleep',
  agent_id: 'ag_kestrel_01',
  payload: {},
};

describe('event envelope harness and model stamp', () => {
  it('accepts a stamped envelope', () => {
    const result = validateWorldEvent({
      ...base,
      harness: 'claude',
      model: 'claude-sonnet-5.5',
    });
    expect(result.ok).toBe(true);
  });

  it('accepts an unstamped envelope, so existing events stay valid', () => {
    expect(validateWorldEvent(base).ok).toBe(true);
  });

  it('rejects a harness that is not a lowercase slug and names the path', () => {
    const result = validateWorldEvent({ ...base, harness: 'Claude' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.includes('/harness'))).toBe(true);
  });

  it('accepts a 32-character harness', () => {
    const harness = `a${'b'.repeat(31)}`;
    expect(harness).toHaveLength(32);
    expect(validateWorldEvent({ ...base, harness }).ok).toBe(true);
  });

  it('rejects a 33-character harness', () => {
    const result = validateWorldEvent({ ...base, harness: 'a'.repeat(33) });
    expect(result.ok).toBe(false);
  });

  it('rejects a harness that starts with a digit', () => {
    const result = validateWorldEvent({ ...base, harness: '1abc' });
    expect(result.ok).toBe(false);
  });

  it('rejects a harness that starts with a hyphen', () => {
    const result = validateWorldEvent({ ...base, harness: '-abc' });
    expect(result.ok).toBe(false);
  });

  it('rejects an empty model and names the path', () => {
    const result = validateWorldEvent({ ...base, model: '' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.includes('/model'))).toBe(true);
  });

  it('accepts a 128-character model', () => {
    const model = `m${'a'.repeat(127)}`;
    expect(model).toHaveLength(128);
    expect(validateWorldEvent({ ...base, model }).ok).toBe(true);
  });

  it('rejects a model longer than 128 characters', () => {
    const result = validateWorldEvent({ ...base, model: `m${'a'.repeat(128)}` });
    expect(result.ok).toBe(false);
  });

  it('rejects a model with a space in it', () => {
    const result = validateWorldEvent({ ...base, model: 'claude sonnet' });
    expect(result.ok).toBe(false);
  });
});
