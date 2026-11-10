/**
 * Adversarial fixtures for the Thought Stream page. Every string here is something a world or an
 * agent can write (speech, names, sign text, plans). The page must show each one as plain text.
 * Used by the render tests only; the browser never loads this file.
 */
import type { Row } from './render-model.ts';

export const HOSTILE: string[] = [
  '<script>alert(1)</script>',
  '<img src=x onerror="alert(1)">',
  'javascript:alert(1)',
  '"><svg onload=alert(1)>',
  '‮evil‬',
  '⁦abc⁩',
  '​'.repeat(500),
  'nul\u0000byte',
  'x'.repeat(10_000),
  '${alert(1)} {{constructor}} __proto__ &amp; &lt;b&gt;',
];

/** A thought row shaped like the Glass API's, with one hostile string in each text field. */
export function hostileRow(text: string, index: number): Row {
  return {
    thought_id: `t-${index}`,
    life_id: `life-${index}`,
    name: text,
    tier: 'local',
    at: '2026-11-10T00:00:00.000Z',
    world_day: 3,
    world_tick: 1200,
    wake_reason: text,
    prompt_template_version: text,
    latency_ms: 812,
    parsed: { plan: text },
  };
}

/** A benign row with the same shape, for comparing the DOM a hostile row produces. */
export function plainRow(index: number): Row {
  return hostileRow('plain', index);
}
