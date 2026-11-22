import { describe, expect, it } from 'vitest';
import {
  BODY_PLAN_CELLS,
  BODY_PLAN_QUEUE_DEPTH,
  BODY_PLAN_SECONDS,
  BODY_PLAN_THROTTLE_WAITS,
  BODY_SEEN_FLUSH_BYTES,
  BODY_SEEN_FLUSHES,
  GolemMetrics,
  MetricRegistry,
} from './metrics.ts';

/** A coordinate pair such as `12,64,-3` or `12 64 -3`: a block position must never reach a label. */
const COORDINATES = /-?\d+[ ,]+-?\d+[ ,]+-?\d+/;

function fresh(): GolemMetrics {
  return new GolemMetrics(new MetricRegistry());
}

describe('GolemMetrics: plan counters and gauges (BLD-27)', () => {
  it('counts each placed, broken and skipped cell by its code', () => {
    const metrics = fresh();
    metrics.planCell('placed');
    metrics.planCell('placed');
    metrics.planCell('broken');
    metrics.planCell('changed');
    const text = metrics.registry.render();
    expect(text).toContain(`${BODY_PLAN_CELLS}{code="placed"} 2`);
    expect(text).toContain(`${BODY_PLAN_CELLS}{code="broken"} 1`);
    expect(text).toContain(`${BODY_PLAN_CELLS}{code="changed"} 1`);
  });

  it('gives every contract cell code its own label, and done_already too', () => {
    const metrics = fresh();
    const codes = [
      'placed',
      'broken',
      'done_already',
      'changed',
      'blocked',
      'no_reference',
      'out_of_reach',
      'not_loaded',
      'missing_materials',
      'no_tool',
      'unbreakable',
      'state_unachievable',
      'timeout',
      'refused',
    ];
    for (const code of codes) metrics.planCell(code);
    const text = metrics.registry.render();
    for (const code of codes) {
      expect(text).toContain(`${BODY_PLAN_CELLS}{code="${code}"} 1`);
    }
    expect(text).not.toContain('code="other"');
  });

  it('records an unknown code or a coordinate-like code as other, never as the raw text', () => {
    const metrics = fresh();
    metrics.planCell('12,64,-3');
    metrics.planCell('a stone at 5 70 9');
    const text = metrics.registry.render();
    expect(text).toContain(`${BODY_PLAN_CELLS}{code="other"} 2`);
    expect(text).not.toMatch(COORDINATES);
    expect(text).not.toContain('stone');
  });

  it('adds plan seconds and ignores a negative or non-finite amount', () => {
    const metrics = fresh();
    metrics.planSeconds(1.5);
    metrics.planSeconds(2);
    metrics.planSeconds(-4);
    metrics.planSeconds(Number.NaN);
    metrics.planSeconds(Number.POSITIVE_INFINITY);
    expect(metrics.registry.render()).toContain(`${BODY_PLAN_SECONDS} 3.5`);
  });

  it('counts throttle waits by whether the lane was paused for TPS', () => {
    const metrics = fresh();
    metrics.planThrottleWait(true);
    metrics.planThrottleWait(false);
    metrics.planThrottleWait(false);
    const text = metrics.registry.render();
    expect(text).toContain(`${BODY_PLAN_THROTTLE_WAITS}{paused="true"} 1`);
    expect(text).toContain(`${BODY_PLAN_THROTTLE_WAITS}{paused="false"} 2`);
  });

  it('counts seen flushes and their bytes, ignoring a negative or non-finite size', () => {
    const metrics = fresh();
    metrics.seenFlush(120);
    metrics.seenFlush(30);
    metrics.seenFlush(-5);
    metrics.seenFlush(Number.NaN);
    const text = metrics.registry.render();
    expect(text).toContain(`${BODY_SEEN_FLUSHES} 2`);
    expect(text).toContain(`${BODY_SEEN_FLUSH_BYTES} 150`);
  });

  it('sets the queue depth gauge, keeps the last value on a non-finite reading, and floors at zero', () => {
    const metrics = fresh();
    metrics.planQueueDepth(4);
    metrics.planQueueDepth(2);
    metrics.planQueueDepth(Number.NaN);
    expect(metrics.registry.render()).toContain(`${BODY_PLAN_QUEUE_DEPTH} 2`);
    metrics.planQueueDepth(-1);
    expect(metrics.registry.render()).toContain(`${BODY_PLAN_QUEUE_DEPTH} 0`);
  });

  it('uses only the closed label names code and paused for plan metrics, and no coordinates', () => {
    const metrics = fresh();
    metrics.planCell('12,64,-3');
    metrics.planCell('placed');
    metrics.planThrottleWait(true);
    metrics.seenFlush(10);
    metrics.planSeconds(1);
    metrics.planQueueDepth(3);
    const text = metrics.registry.render();
    const names = new Set(text.match(/[a-zA-Z_]+(?=="|=")/g));
    expect([...names].sort()).toEqual(['code', 'paused']);
    expect(text).not.toMatch(COORDINATES);
  });
});
