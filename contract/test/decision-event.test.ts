import { describe, expect, it } from 'vitest';
import { validateDecisionEventPayload } from '../src/index.ts';

const base = () => ({
  life_id: 'ag_kestrel_01',
  decision_id: 'dec_pick_route_0007',
  engine_version: 1,
  producer: 'body',
  fx: 'route',
  kind: 'deterministic',
});

const ROLL_ID = 'ev_01HZX3V9Q4M2K8R7T6Y5W4E3D8';

describe('decision event payload', () => {
  it('accepts a deterministic decision with no die and no rolls', () => {
    expect(validateDecisionEventPayload(base()).ok).toBe(true);
  });

  it('accepts a d20 decision that names its rolls', () => {
    const d20 = { ...base(), kind: 'd20', roll_event_ids: [ROLL_ID] };
    expect(validateDecisionEventPayload(d20).ok).toBe(true);
  });

  it('refuses a d20 decision with no roll_event_ids', () => {
    expect(validateDecisionEventPayload({ ...base(), kind: 'd20' }).ok).toBe(false);
  });

  it('refuses a d20 decision with more than four roll_event_ids', () => {
    const many = [ROLL_ID, ROLL_ID, ROLL_ID, ROLL_ID, ROLL_ID];
    expect(validateDecisionEventPayload({ ...base(), kind: 'd20', roll_event_ids: many }).ok).toBe(
      false,
    );
  });

  it('accepts a uniform pick with a uniform draw between 0 and 1', () => {
    const pick = {
      ...base(),
      kind: 'uniform',
      result: { decision: 'north', options: [{ name: 'north', weight: 1 }], uniform: 0.4 },
    };
    expect(validateDecisionEventPayload(pick).ok).toBe(true);
    const outside = { ...pick, result: { ...pick.result, uniform: 1.5 } };
    expect(validateDecisionEventPayload(outside).ok).toBe(false);
  });

  it('accepts an audit_gap that records dropped events and the tick they began at', () => {
    const gap = { ...base(), kind: 'audit_gap', dropped: 3, since_tick: 72000 };
    expect(validateDecisionEventPayload(gap).ok).toBe(true);
  });

  it('refuses an audit_gap with no dropped count', () => {
    const gap = { ...base(), kind: 'audit_gap', since_tick: 72000 };
    expect(validateDecisionEventPayload(gap).ok).toBe(false);
  });

  it('refuses an audit_gap with no since_tick', () => {
    const gap = { ...base(), kind: 'audit_gap', dropped: 3 };
    expect(validateDecisionEventPayload(gap).ok).toBe(false);
  });

  it('refuses an unknown kind', () => {
    expect(validateDecisionEventPayload({ ...base(), kind: 'coin' }).ok).toBe(false);
  });

  it('refuses a policy that is not name@version', () => {
    expect(validateDecisionEventPayload({ ...base(), policy: 'route' }).ok).toBe(false);
    expect(validateDecisionEventPayload({ ...base(), policy: 'route@2' }).ok).toBe(true);
  });

  it('refuses a model_called field, because a decision links to thoughts, not to rolls it did not make', () => {
    expect(validateDecisionEventPayload({ ...base(), model_called: true }).ok).toBe(false);
  });
});
