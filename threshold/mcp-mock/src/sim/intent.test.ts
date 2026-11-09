import type { Intent } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { advanceIntent, startIntent } from './intent.ts';

function spec(over: Partial<Intent> = {}, args: Record<string, unknown> = {}): Intent {
  return {
    goal: 'go',
    program: 'travel',
    arguments: args,
    preconditions: [],
    wake_on: ['goal_completed'],
    limits: { max_world_ticks: 100000, max_block_operations: 10 },
    ...over,
  } as Intent;
}

function start(s: Intent, facts: string[] = [], defaultTicks = 600) {
  const r = startIntent(s, 1000, defaultTicks, new Set(facts));
  if (!r.ok) throw new Error('did not start');
  return r.state;
}

describe('startIntent', () => {
  it.each([[0], [1.5], ['300'], [-5], [Number.NaN]])(
    'falls back to default_ticks for mock_ticks %j',
    (mock) => {
      const r = startIntent(spec({}, { mock_ticks: mock }), 1000, 600, new Set());
      expect(r.ok && r.state.durationTicks).toBe(600);
    },
  );

  it('refuses a missing precondition', () => {
    const r = startIntent(
      spec({ preconditions: ['has_axe'] } as Partial<Intent>),
      0,
      600,
      new Set(),
    );
    expect(r).toEqual({ ok: false, reason: 'precondition_false' });
  });

  it('uses defaultTicks when mock_ticks is absent', () => {
    const state = start(spec(), [], 250);
    expect(advanceIntent(state, 1249, new Set()).finished).toBeNull();
    expect(advanceIntent(state, 1250, new Set()).finished).toBe('completed');
  });
});

describe('advanceIntent', () => {
  it('runs then completes, clamping progress', () => {
    const state = start(spec({}, { mock_ticks: 300 }));
    const mid = advanceIntent(state, 1100, new Set());
    expect(mid.finished).toBeNull();
    expect(mid.state.status).toBe('running');
    expect(mid.state.checkpoint.progress_ticks).toBe(100);
    const end = advanceIntent(state, 5000, new Set());
    expect(end.finished).toBe('completed');
    expect(end.state.progressTicks).toBe(300);
  });

  it('ends limit_reached at max_world_ticks', () => {
    const state = start(
      spec({ limits: { max_world_ticks: 50, max_block_operations: 1 } }, { mock_ticks: 300 }),
    );
    const r = advanceIntent(state, 2000, new Set());
    expect(r.finished).toBe('limit_reached');
    expect(r.state.progressTicks).toBe(50);
  });

  it('completes when max_world_ticks equals the length', () => {
    const state = start(
      spec({ limits: { max_world_ticks: 300, max_block_operations: 1 } }, { mock_ticks: 300 }),
    );
    const r = advanceIntent(state, 2000, new Set());
    expect(r.finished).toBe('completed');
    expect(r.state.progressTicks).toBe(300);
  });

  it('fails when a precondition is cleared', () => {
    const state = start(
      spec({ preconditions: ['has_axe'] } as Partial<Intent>, { mock_ticks: 300 }),
      ['has_axe'],
    );
    const r = advanceIntent(state, 1200, new Set());
    expect(r.finished).toBe('failed');
    expect(r.failure).toBe('precondition_failed');
    expect(r.state.progressTicks).toBe(200);
  });
});
