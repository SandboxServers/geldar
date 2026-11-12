import { validatePlanMessage } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { newId } from '../ids.ts';
import { Admission, REFLECTION_COST, THOUGHT_COST } from './admission.ts';
import { chooseEffort, HIGH_DEADLINE_CAP_S, isRepeatedFailureWake, jobShape } from './effort.ts';
import { continueInterrupted, IntentLedger } from './fallback.ts';
import { buildThoughtRow, estimateTokens } from './journal-row.ts';
import {
  intentEvent,
  makeSnapshot,
  OPTIONS,
  planResultEvent,
  VALID_THOUGHT,
} from './loop-fixtures.ts';
import { buildPlan } from './plan.ts';

describe('Admission', () => {
  it('refuses a call over the cap and counts a reflection as two', () => {
    const admission = new Admission(3, () => 0);
    expect(admission.reserve(REFLECTION_COST)).not.toBeNull();
    expect(admission.remaining()).toBe(1);
    expect(admission.reserve(REFLECTION_COST)).toBeNull();
    expect(admission.reserve(THOUGHT_COST)).not.toBeNull();
    expect(admission.remaining()).toBe(0);
    expect(admission.reserve(THOUGHT_COST)).toBeNull();
  });

  it('forgets credits after an hour, not before', () => {
    let now = 1_000_000;
    const admission = new Admission(1, () => now);
    admission.reserve(1);
    now += 3_599_000;
    expect(admission.reserve(1)).toBeNull();
    now += 2_000;
    expect(admission.reserve(1)).not.toBeNull();
  });

  it('gives credits back on release, once', () => {
    const admission = new Admission(1, () => 0);
    const held = admission.reserve(1);
    held?.release();
    held?.release();
    expect(admission.remaining()).toBe(1);
  });
});

describe('effort', () => {
  const calm = { failedIntentsInARow: 0, repeatedFailureWake: false, stuck: null };

  it('is minimal without signals and high with each one', () => {
    expect(chooseEffort(calm).level).toBe('minimal');
    expect(chooseEffort({ ...calm, failedIntentsInARow: 1 }).level).toBe('minimal');
    expect(chooseEffort({ ...calm, failedIntentsInARow: 2 })).toEqual({
      level: 'high',
      reasons: ['failed_intents'],
    });
    expect(chooseEffort({ ...calm, repeatedFailureWake: true }).level).toBe('high');
    expect(chooseEffort({ ...calm, stuck: { action: 'goto', repeat_count: 3 } }).level).toBe(
      'high',
    );
  });

  it('counts a failure wake as repeated only after another failure wake', () => {
    expect(isRepeatedFailureWake(null, 'action_failed')).toBe(false);
    expect(isRepeatedFailureWake('idle', 'action_failed')).toBe(false);
    expect(isRepeatedFailureWake('precondition_failed', 'action_failed')).toBe(true);
    expect(isRepeatedFailureWake('action_failed', 'idle')).toBe(false);
  });

  it('turns reasoning on, raises tokens and caps the deadline for high effort', () => {
    expect(jobShape('minimal', OPTIONS.thought)).toEqual({
      maxTokens: 600,
      deadlineS: 25,
      reasoning: 'off',
    });
    expect(jobShape('high', OPTIONS.thought)).toEqual({
      maxTokens: 1200,
      deadlineS: 50,
      reasoning: 'on',
    });
    expect(jobShape('high', { ...OPTIONS.thought, deadlineS: 50 }).deadlineS).toBe(
      HIGH_DEADLINE_CAP_S,
    );
  });
});

describe('IntentLedger and continueInterrupted', () => {
  it('resumes an interrupted gather with the remaining ticks and no id reuse', () => {
    const ledger = new IntentLedger();
    const id = newId('in');
    ledger.observe(intentEvent(id, 'accepted', 100));
    ledger.observe(intentEvent(id, 'interrupted', 400, 'gather', false));
    const next = continueInterrupted(ledger);
    expect(next?.resumedIntentId).toBe(id);
    expect(next?.remainingTicks).toBe(1700);
    expect(next?.thought.intent?.limits.max_world_ticks).toBe(1700);
    expect(next?.thought.actions).toBeUndefined();
  });

  it('holds when the intent did not end interrupted', () => {
    const ledger = new IntentLedger();
    for (const state of ['completed', 'failed', 'running'] as const) {
      const id = newId('in');
      ledger.observe(intentEvent(id, 'accepted', 100));
      ledger.observe(intentEvent(id, state, 200, 'gather', false));
    }
    expect(continueInterrupted(ledger)).toBeNull();
  });

  it('holds for a program outside the Phase 0 allow-list', () => {
    for (const program of ['trade_wait', 'build', 'mySkill']) {
      const ledger = new IntentLedger();
      const id = newId('in');
      ledger.observe(intentEvent(id, 'accepted', 100, program));
      ledger.observe(intentEvent(id, 'interrupted', 200, program, false));
      expect(continueInterrupted(ledger), program).toBeNull();
    }
  });

  it('holds when the tick budget is spent or the start was never seen', () => {
    const spent = new IntentLedger();
    const a = newId('in');
    spent.observe(intentEvent(a, 'accepted', 100));
    spent.observe(intentEvent(a, 'interrupted', 2100, 'gather', false));
    expect(continueInterrupted(spent)).toBeNull();

    const unseen = new IntentLedger();
    unseen.observe(intentEvent(newId('in'), 'interrupted', 300));
    expect(continueInterrupted(unseen)).toBeNull();
  });

  it('never resumes the same interrupted intent twice and ignores repeated events', () => {
    const ledger = new IntentLedger();
    const id = newId('in');
    const accepted = intentEvent(id, 'accepted', 100);
    ledger.observe(accepted);
    ledger.observe(accepted);
    ledger.observe(intentEvent(id, 'interrupted', 400, 'gather', false));
    ledger.markResubmitted(id);
    expect(continueInterrupted(ledger)).toBeNull();
  });

  it('counts only intent failed events toward failures in a row', () => {
    const ledger = new IntentLedger();
    ledger.observe(intentEvent(newId('in'), 'failed', 100));
    expect(ledger.failedInARow).toBe(1);
    // A refused plan is not a failed intent: the same failure must not count twice.
    ledger.observe(planResultEvent('precondition_failed'));
    expect(ledger.failedInARow).toBe(1);
    ledger.observe(intentEvent(newId('in'), 'failed', 200));
    expect(ledger.failedInARow).toBe(2);
  });

  it('resets failures in a row on a completion or a started plan', () => {
    const ledger = new IntentLedger();
    ledger.observe(intentEvent(newId('in'), 'failed', 100));
    ledger.observe(intentEvent(newId('in'), 'failed', 200));
    ledger.observe(planResultEvent('started'));
    expect(ledger.failedInARow).toBe(0);
    ledger.observe(intentEvent(newId('in'), 'failed', 300));
    ledger.observe(intentEvent(newId('in'), 'completed', 400));
    expect(ledger.failedInARow).toBe(0);
  });

  it('resumes only the most recently changed intent', () => {
    const ledger = new IntentLedger();
    const older = newId('in');
    ledger.observe(intentEvent(older, 'accepted', 100));
    ledger.observe(intentEvent(older, 'interrupted', 200, 'gather', false));
    const newer = newId('in');
    ledger.observe(intentEvent(newer, 'accepted', 300));
    ledger.observe(intentEvent(newer, 'completed', 400, 'gather', false));
    // The older interrupted intent is stale now: a later intent ended, so it is not resumed.
    expect(continueInterrupted(ledger)).toBeNull();
  });
});

describe('buildPlan', () => {
  it('mints ids per action and intent and sets the envelope from the snapshot', () => {
    const snapshot = makeSnapshot();
    const thought = JSON.parse(VALID_THOUGHT);
    const plan = buildPlan({ thought, thoughtId: newId('th'), snapshot, expiresAfterTicks: 1200 });
    expect(plan.action_ids).toHaveLength(1);
    expect(plan.intent_id).toMatch(/^in_/);
    expect(plan.expires_tick).toBe(2200);
    expect(plan.body_generation).toBe(2);
    expect(plan.snapshot_revision).toBe(7);
    expect(validatePlanMessage(plan).ok).toBe(true);
  });

  it('has no intent id when the thought starts no intent', () => {
    const plan = buildPlan({
      thought: { reasoning: 'hi', say: 'hello' },
      thoughtId: newId('th'),
      snapshot: makeSnapshot(),
      expiresAfterTicks: 10,
    });
    expect(plan.intent_id).toBeUndefined();
    expect(plan.action_ids).toEqual([]);
  });
});

describe('buildThoughtRow', () => {
  it('estimates tokens as chars over four, rounded up', () => {
    expect(estimateTokens(9)).toBe(3);
    const row = buildThoughtRow({
      thoughtId: newId('th'),
      snapshot: makeSnapshot(),
      wakeReason: 'idle',
      messages: [{ role: 'user', content: 'abcdefghi' }],
      templateVersion: 'v1',
      versions: OPTIONS.versions,
      modelConfig: OPTIONS.modelConfig,
      effort: 'minimal',
      completion: {
        text: 'abcd',
        thinkerId: 't',
        latencyMs: 5,
        usageReported: { promptTokens: 3, completionTokens: 1 },
      },
      parsed: null,
      creditsReserved: 1,
      creditsSettled: 1,
      at: '2026-11-09T10:00:00.000Z',
    });
    expect(row.tokensInEstimated).toBe(3);
    expect(row.tokensOutEstimated).toBe(1);
    expect(row.providerUsage).toEqual({
      prompt_tokens: 3,
      completion_tokens: 1,
      source: 'provider',
    });
  });
});
