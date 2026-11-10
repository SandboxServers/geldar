import { describe, expect, it } from 'vitest';
import {
  MAX_RESPONSE_FORMAT_BYTES,
  planSubject,
  snapshotSubject,
  validatePlanAck,
  validatePlanMessage,
  validatePlanResultPayload,
  validateReflection,
  validateSnapshot,
  validateSnapshotRequest,
  validateSpeechPayload,
  validateThinkerFrame,
  validateThoughtEventPayload,
} from '../src/index.ts';

const thoughtId = 'th_01HZX3V9Q4M2K8R7T6Y5W4E3D1';
const intentId = 'in_01HZX3V9Q4M2K8R7T6Y5W4E3D5';
const actionId = 'ac_01HZX3V9Q4M2K8R7T6Y5W4E3D7';
const snapshotId = 'sn_01HZX3V9Q4M2K8R7T6Y5W4E3D9';

const reflection = {
  memories_to_keep: ['Sage shared bread with me.'],
  relationship_updates: [{ name: 'Sage', impression: 'kind', trust: 70 }],
  beliefs_add: [{ belief: 'Iron is north of the lake.', kind: 'observation' }],
  beliefs_remove: ['The cave is safe.'],
  goals: [{ goal: 'Build a shelter', why: 'Night is dangerous.' }],
  day_summary: 'A quiet day.',
};

const plan = {
  thought_id: thoughtId,
  life_id: 'ag_adam_01',
  body_generation: 1,
  source_snapshot_id: snapshotId,
  snapshot_revision: 4,
  expires_tick: 2400,
  intent_id: intentId,
  action_ids: [actionId],
  thought: { reasoning: 'Eat first.', actions: [{ do: 'eat' }] },
};

describe('Reflection', () => {
  it('accepts a valid reflection and empty lists', () => {
    expect(validateReflection(reflection).ok).toBe(true);
    expect(
      validateReflection({
        ...reflection,
        memories_to_keep: [],
        relationship_updates: [],
        beliefs_add: [],
        beliefs_remove: [],
        goals: [],
        day_summary: '',
      }).ok,
    ).toBe(true);
  });

  it('accepts an optional due_tick on a belief, and rejects a negative or fractional one', () => {
    const belief = { belief: 'two loaves to Pike', kind: 'commitment' };
    expect(validateReflection({ ...reflection, beliefs_add: [belief] }).ok).toBe(true);
    const due = { ...reflection, beliefs_add: [{ ...belief, due_tick: 9000 }] };
    expect(validateReflection(due).ok).toBe(true);
    const negative = { ...reflection, beliefs_add: [{ ...belief, due_tick: -1 }] };
    expect(validateReflection(negative).ok).toBe(false);
    const fractional = { ...reflection, beliefs_add: [{ ...belief, due_tick: 1.5 }] };
    expect(validateReflection(fractional).ok).toBe(false);
  });

  it('rejects over-cap, bad enum, bad trust and extra properties', () => {
    expect(validateReflection({ ...reflection, memories_to_keep: Array(9).fill('x') }).ok).toBe(
      false,
    );
    expect(validateReflection({ ...reflection, memories_to_keep: ['x'.repeat(281)] }).ok).toBe(
      false,
    );
    expect(validateReflection({ ...reflection, day_summary: 'x'.repeat(1201) }).ok).toBe(false);
    expect(
      validateReflection({ ...reflection, goals: Array(9).fill(reflection.goals[0]) }).ok,
    ).toBe(false);
    expect(
      validateReflection({
        ...reflection,
        goals: [{ goal: 'x'.repeat(121), why: 'y' }],
      }).ok,
    ).toBe(false);
    expect(
      validateReflection({
        ...reflection,
        beliefs_add: [{ belief: 'b', kind: 'rumour' }],
      }).ok,
    ).toBe(false);
    expect(
      validateReflection({
        ...reflection,
        relationship_updates: [{ name: 'Sage', impression: 'kind', trust: 101 }],
      }).ok,
    ).toBe(false);
    expect(validateReflection({ ...reflection, extra: 1 }).ok).toBe(false);
    const { day_summary: _missing, ...rest } = reflection;
    expect(validateReflection(rest).ok).toBe(false);
  });
});

describe('SnapshotRequest', () => {
  it('accepts a valid request and rejects bad ones', () => {
    expect(validateSnapshotRequest({ life_id: 'ag_adam_01', reason: 'wake' }).ok).toBe(true);
    expect(validateSnapshotRequest({ life_id: 'adam', reason: 'wake' }).ok).toBe(false);
    expect(validateSnapshotRequest({ life_id: 'ag_adam_01', reason: 'x'.repeat(65) }).ok).toBe(
      false,
    );
    expect(validateSnapshotRequest({ life_id: 'ag_adam_01' }).ok).toBe(false);
  });
});

describe('PlanMessage', () => {
  it('accepts a plan with and without an intent id', () => {
    expect(validatePlanMessage(plan).ok).toBe(true);
    const { intent_id: _intent, ...noIntent } = plan;
    expect(validatePlanMessage({ ...noIntent, action_ids: [] }).ok).toBe(true);
  });

  it('rejects bad ids, too many actions, a bad thought and extra properties', () => {
    expect(validatePlanMessage({ ...plan, action_ids: ['x'] }).ok).toBe(false);
    expect(validatePlanMessage({ ...plan, action_ids: Array(7).fill(actionId) }).ok).toBe(false);
    expect(validatePlanMessage({ ...plan, thought: { reasoning: 'only' } }).ok).toBe(false);
    expect(validatePlanMessage({ ...plan, extra: 1 }).ok).toBe(false);
    expect(validatePlanMessage({ ...plan, thought_id: 'nope' }).ok).toBe(false);
    expect(validatePlanMessage({ ...plan, expires_tick: -1 }).ok).toBe(false);
  });
});

describe('PlanAck', () => {
  it('accepts an acceptance and each rejection reason', () => {
    expect(validatePlanAck({ thought_id: thoughtId, accepted: true, rejection: null }).ok).toBe(
      true,
    );
    for (const reason of [
      'wrong_life',
      'stale_generation',
      'stale_snapshot',
      'expired',
      'invalid_plan',
    ]) {
      const ack = { thought_id: thoughtId, accepted: false, rejection: { reason, detail: 'd' } };
      expect(validatePlanAck(ack).ok).toBe(true);
    }
  });

  it('rejects an unknown reason, a long detail and a missing rejection', () => {
    const bad = { reason: 'tired', detail: 'd' };
    expect(validatePlanAck({ thought_id: thoughtId, accepted: false, rejection: bad }).ok).toBe(
      false,
    );
    const long = { reason: 'expired', detail: 'x'.repeat(257) };
    expect(validatePlanAck({ thought_id: thoughtId, accepted: false, rejection: long }).ok).toBe(
      false,
    );
    expect(validatePlanAck({ thought_id: thoughtId, accepted: true }).ok).toBe(false);
  });
});

describe('PlanResultPayload', () => {
  const result = {
    thought_id: thoughtId,
    intent: 'started',
    failed_at: null,
    actions: [{ action_id: actionId, state: 'completed' }],
    said: true,
  };

  it('accepts a result and a failed action with a reason', () => {
    expect(validatePlanResultPayload(result).ok).toBe(true);
    expect(
      validatePlanResultPayload({
        ...result,
        intent: 'skipped',
        failed_at: 0,
        actions: [{ action_id: actionId, state: 'failed', reason: 'not_possible' }],
      }).ok,
    ).toBe(true);
  });

  it('rejects an unknown disposition or state, too many actions and extras', () => {
    expect(validatePlanResultPayload({ ...result, intent: 'maybe' }).ok).toBe(false);
    expect(
      validatePlanResultPayload({ ...result, actions: [{ action_id: actionId, state: 'done' }] })
        .ok,
    ).toBe(false);
    expect(
      validatePlanResultPayload({
        ...result,
        actions: Array(7).fill({ action_id: actionId, state: 'completed' }),
      }).ok,
    ).toBe(false);
    expect(validatePlanResultPayload({ ...result, said: 'yes' }).ok).toBe(false);
    expect(validatePlanResultPayload({ ...result, extra: 1 }).ok).toBe(false);
  });
});

describe('SpeechPayload', () => {
  it('accepts heard and own speech', () => {
    expect(validateSpeechPayload({ from: 'Sage', text: 'hi', distance: 3.5, own: false }).ok).toBe(
      true,
    );
    expect(
      validateSpeechPayload({ from: 'Adam', text: 'hello', distance: null, own: true }).ok,
    ).toBe(true);
  });

  it('rejects long text, a long name, a missing distance and extras', () => {
    const ok = { from: 'Sage', text: 'hi', distance: 1, own: false };
    expect(validateSpeechPayload({ ...ok, text: 'x'.repeat(257) }).ok).toBe(false);
    expect(validateSpeechPayload({ ...ok, from: 'x'.repeat(33) }).ok).toBe(false);
    expect(validateSpeechPayload({ from: 'Sage', text: 'hi', own: false }).ok).toBe(false);
    expect(validateSpeechPayload({ ...ok, extra: 1 }).ok).toBe(false);
  });
});

describe('ThoughtEventPayload', () => {
  const event = {
    thought_id: thoughtId,
    wake_reason: 'directly_addressed',
    outcome: 'planned',
    latency_ms: 8200,
    model_config: 'qwen3:32b@Q4_K_M',
    effort: 'standard',
    intent_id: null,
  };

  it('accepts every outcome and an intent id', () => {
    for (const outcome of [
      'planned',
      'fallback_continue',
      'fallback_hold',
      'tired',
      'model_error',
      'invalid_output',
    ]) {
      expect(validateThoughtEventPayload({ ...event, outcome }).ok).toBe(true);
    }
    expect(validateThoughtEventPayload({ ...event, intent_id: intentId }).ok).toBe(true);
  });

  it('rejects an unknown outcome, a negative latency, a long wake reason and extras', () => {
    expect(validateThoughtEventPayload({ ...event, outcome: 'ok' }).ok).toBe(false);
    expect(validateThoughtEventPayload({ ...event, latency_ms: -1 }).ok).toBe(false);
    expect(validateThoughtEventPayload({ ...event, wake_reason: 'x'.repeat(65) }).ok).toBe(false);
    expect(validateThoughtEventPayload({ ...event, extra: 1 }).ok).toBe(false);
  });
});

describe('job frame response_format and reasoning (decision 0049)', () => {
  const job = {
    type: 'job',
    job_id: 'jb_01HZX3V9Q4M2K8R7T6Y5W4E3D2',
    model: 'qwen3:32b',
    messages: [{ role: 'user', content: 'go' }],
    max_tokens: 600,
    temperature: 0.7,
    stop: null,
    deadline: '2026-11-08T21:14:05Z',
  };

  it('counts response_format bytes, not UTF-16 units', () => {
    // 3 bytes per character in UTF-8, so this is under the limit in units but over it in bytes.
    const pad = '\u20ac'.repeat(Math.ceil(MAX_RESPONSE_FORMAT_BYTES / 2));
    const format = { type: 'json_schema', schema: { pad } };
    expect(validateThinkerFrame({ ...job, response_format: format }).ok).toBe(false);
  });

  it('accepts the two optional fields and still accepts a frame without them', () => {
    expect(validateThinkerFrame(job).ok).toBe(true);
    const format = { type: 'json_schema', schema: { type: 'object' } };
    expect(validateThinkerFrame({ ...job, response_format: format, reasoning: 'on' }).ok).toBe(
      true,
    );
  });

  it('rejects a bad format type, a bad reasoning value and an oversized schema', () => {
    const schema = { type: 'object' };
    expect(validateThinkerFrame({ ...job, response_format: { type: 'regex', schema } }).ok).toBe(
      false,
    );
    expect(validateThinkerFrame({ ...job, response_format: { type: 'json_schema' } }).ok).toBe(
      false,
    );
    expect(validateThinkerFrame({ ...job, reasoning: 'maybe' }).ok).toBe(false);
    const big = { type: 'json_schema', schema: { pad: 'x'.repeat(MAX_RESPONSE_FORMAT_BYTES) } };
    expect(validateThinkerFrame({ ...job, response_format: big }).ok).toBe(false);
  });
});

describe('Body-Mind subjects', () => {
  it('builds the five-token body subjects', () => {
    expect(snapshotSubject('phase0', 'ag_adam_01')).toBe('geldar.phase0.body.ag_adam_01.snapshot');
    expect(planSubject('phase0', 'ag_adam_01')).toBe('geldar.phase0.body.ag_adam_01.plan');
  });

  it('keeps the body subjects out of the geldar.*.* event filter but not event subjects', () => {
    const matchesEvents = (subject: string): boolean => subject.split('.').length === 3;
    expect(matchesEvents('geldar.phase0.thought')).toBe(true);
    expect(matchesEvents('geldar.phase0.plan_result')).toBe(true);
    expect(matchesEvents(snapshotSubject('phase0', 'ag_adam_01'))).toBe(false);
    expect(matchesEvents(planSubject('phase0', 'ag_adam_01'))).toBe(false);
  });

  it('refuses a shard or life id that could add or widen tokens', () => {
    expect(() => snapshotSubject('a.b', 'ag_adam_01')).toThrow();
    expect(() => planSubject('phase0', 'ag_adam_01.>')).toThrow();
    expect(() => planSubject('phase0', '*')).toThrow();
    expect(() => snapshotSubject('', 'ag_adam_01')).toThrow();
  });
});

describe('snapshot optional fields (P0-20)', () => {
  const base = {
    snapshot_id: 'sn_01HZX3V9Q4M2K8R7T6Y5W4E3D2',
    agent_id: 'ag_adam_01',
    shard: 'phase0',
    world_time: { day: 0, time_of_day: 'day', ticks: 100, weather: 'clear' },
    self: {
      position: { x: 0, y: 64, z: 0 },
      health: 20,
      hunger: 20,
      armor: 0,
      held_item: null,
      inventory: [],
      effects: [],
      budget_remaining_thoughts: 1,
      days_since_sleep: 0,
    },
    surroundings: { blocks_summary: '', notable_blocks: [], entities: [], agents: [] },
    heard: [],
    events_since_last_thought: [],
    revision: 0,
  };
  const withSelf = (extra: Record<string, unknown>): Record<string, unknown> => ({
    ...base,
    self: { ...base.self, ...extra },
  });

  it('still validates without unlocked_recipes and body_generation', () => {
    expect(validateSnapshot(base).ok).toBe(true);
  });

  it('accepts unlocked_recipes and body_generation', () => {
    expect(
      validateSnapshot({ ...withSelf({ unlocked_recipes: ['oak_planks'] }), body_generation: 2 })
        .ok,
    ).toBe(true);
  });

  it('rejects duplicate or bad recipes, too many recipes and a negative generation', () => {
    expect(validateSnapshot(withSelf({ unlocked_recipes: ['stick', 'stick'] })).ok).toBe(false);
    expect(validateSnapshot(withSelf({ unlocked_recipes: ['Not Valid'] })).ok).toBe(false);
    const many = Array.from({ length: 1501 }, (_, i) => `item_${i}`);
    expect(validateSnapshot(withSelf({ unlocked_recipes: many })).ok).toBe(false);
    expect(validateSnapshot({ ...base, body_generation: -1 }).ok).toBe(false);
  });
});
