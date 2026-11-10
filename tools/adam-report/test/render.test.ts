import { describe, expect, it } from 'vitest';
import { renderMarkdown, stableJson } from '../src/render.ts';
import { computeReport, type Report } from '../src/report.ts';
import { toLiteSnapshot } from '../src/snapshot.ts';
import type { RunData } from '../src/types.ts';
import {
  action,
  criteria,
  event,
  intent,
  manifest,
  MIN_MS,
  receipt,
  snap,
  T0,
  thought,
} from './fixture.ts';

const GENERATED = '2026-11-10T10:00:00.000Z';

/** A clean run: every row is a plain value, so the report body is the measures alone. */
const cleanData: RunData = {
  thoughts: [
    thought('th-1', { snapshot: toLiteSnapshot(snap({ hunger: 18 })), latencyMs: 1200 }),
    thought('th-2', {
      atMs: T0 + MIN_MS,
      tick: 1300,
      wakeReason: 'event',
      latencyMs: 2400,
      snapshot: toLiteSnapshot(snap()),
    }),
    thought('th-3', { atMs: T0 + 2 * MIN_MS, tick: 2600, called: false, latencyMs: null }),
  ],
  intents: [intent('in-1', { startedTick: 100, endedTick: 900 })],
  actions: [action('ac-1', { intentId: 'in-1' })],
  receipts: [receipt('ac-1', 'committed', T0 + MIN_MS)],
  events: [event('sleep', 0, T0 + MIN_MS)],
};

/**
 * Text an agent or a shard controls: thought reasoning, chat, sign text, item and block names,
 * an end reason. Each carries markup, HTML and Markdown-injection characters.
 */
const HOSTILE = {
  wake: '<script>alert(1)</script> | *bold* `code` [click](https://evil.example)',
  reason: 'interrupted:chatter <img src=x onerror=alert(2)> # injected heading',
  held: '<b>stone</b>|\n| injected | row |',
  sign: '[link](javascript:alert(3)) <!-- hidden -->',
};

const hostileData: RunData = {
  thoughts: [
    thought('th-h1', {
      wakeReason: HOSTILE.wake,
      snapshot: toLiteSnapshot({
        ...snap({ held: HOSTILE.held, inventory: [[HOSTILE.held, 3]] }),
        surroundings: [{ kind: 'sign', text: HOSTILE.sign }],
        heard: [{ speaker: 'agent-x', text: HOSTILE.sign }],
      }),
    }),
  ],
  intents: [intent('in-h1', { state: 'completed', endReason: HOSTILE.reason })],
  actions: [action('ac-h1', { intentId: 'in-h1', kind: 'place', placeBlock: HOSTILE.held })],
  receipts: [receipt('ac-h1', 'committed', T0)],
  events: [],
};

function reportOf(data: RunData): Report {
  return computeReport({ manifest: manifest(), criteria: criteria(), data });
}

describe('the report renderers', () => {
  it('the Markdown report matches its snapshot', () => {
    expect(renderMarkdown(reportOf(cleanData), GENERATED)).toMatchSnapshot();
  });

  it('the JSON report matches its snapshot', () => {
    const report = reportOf(cleanData);
    expect(stableJson({ ...report, generatedAt: GENERATED })).toMatchSnapshot();
  });

  it('untrusted text is not in the report body, in either format', () => {
    const report = reportOf(hostileData);
    const md = renderMarkdown(report, GENERATED);
    const json = stableJson({ ...report, generatedAt: GENERATED });
    for (const body of [md, json]) {
      for (const text of Object.values(HOSTILE)) {
        expect(body).not.toContain(text);
      }
      expect(body).not.toMatch(/<|>|javascript:|evil|injected|onerror|alert\(/);
    }
  });
});
