import type { CharacterSheet } from '@geldar/contract';
import { type DrawKey, decisionId, rngFor, roll, STANDARD_SHEET } from '@geldar/psyche';
import { describe, expect, it } from 'vitest';
import {
  type AuditEnvelope,
  adoptionRecord,
  decisionEventId,
  decisionRecord,
  gapRecord,
  rollEventId,
  rollRecord,
} from './audit-events.ts';

const LIFE = 'ag_kestrel_01';
const KEY: DrawKey = {
  lifeId: LIFE,
  producer: 'body',
  generation: 1,
  tick: 100,
  fx: 'novelty',
  decisionSeq: 0,
};
const CTX: AuditEnvelope = {
  shard: 'phase0',
  lifeId: LIFE,
  tick: 999,
  at: '2026-01-01T00:00:00.000Z',
};
const SHEET = STANDARD_SHEET as unknown as CharacterSheet;
const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);

function rollFor(key: DrawKey = KEY) {
  return roll(key.fx, 3, 11, rngFor(key));
}

describe('stable ids', () => {
  it('gives one roll id for the same key and draw index, a new one per draw index', () => {
    expect(rollEventId(KEY, 0)).toBe(rollEventId(KEY, 0));
    expect(rollEventId(KEY, 0)).not.toBe(rollEventId(KEY, 1));
    expect(rollEventId(KEY, 0)).toMatch(/^ev_/);
  });

  it('gives one adoption id per life and hash', () => {
    const a = adoptionRecord(CTX, SHEET, H1, 'config');
    const b = adoptionRecord(CTX, SHEET, H1, 'config');
    const c = adoptionRecord(CTX, SHEET, H2, 'config');
    expect(a.ok && b.ok && c.ok, JSON.stringify([a, c])).toBe(true);
    if (!a.ok || !b.ok || !c.ok) return;
    expect(a.event.source_event_id).toBe(b.event.source_event_id);
    expect(a.event.source_event_id).not.toBe(c.event.source_event_id);
  });
});

describe('roll records', () => {
  it('builds a valid roll event keyed on the draw and the world tick of the draw', () => {
    const built = rollRecord(CTX, KEY, rollFor(), 0);
    expect(built.ok, JSON.stringify(built)).toBe(true);
    if (!built.ok) return;
    expect(built.event.type).toBe('roll');
    expect(built.event.source_event_id).toBe(rollEventId(KEY, 0));
    expect(built.event.agent_id).toBe(LIFE);
    expect(built.event.world_tick).toBe(KEY.tick);
    expect(built.event.payload.decision_id).toBe(decisionId(KEY));
    expect(built.event.payload.engine_version).toBe(1);
    expect(built.event.payload.producer).toBe('body');
  });

  it('refuses a roll with three dice, with the reason', () => {
    const built = rollRecord(CTX, KEY, { ...rollFor(), dice: [1, 2, 3] }, 0);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors.join(' ')).toMatch(/dice/);
  });

  it('refuses a roll whose fx is not the key fx', () => {
    const built = rollRecord(CTX, KEY, { ...rollFor(), fx: 'other' }, 0);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors.join(' ')).toMatch(/does not match/);
  });
});

describe('decision and gap records', () => {
  it('builds a decision with the key decision id and a stable event id', () => {
    const built = decisionRecord(CTX, KEY, {
      fx: 'novelty',
      kind: 'uniform',
      result: { uniform: 0.25 },
    });
    expect(built.ok, JSON.stringify(built)).toBe(true);
    if (!built.ok) return;
    expect(built.event.type).toBe('decision');
    expect(built.event.payload.decision_id).toBe(decisionId(KEY));
    expect(built.event.source_event_id).toBe(decisionEventId(decisionId(KEY)));
  });

  it('refuses a decision with an unknown kind', () => {
    const built = decisionRecord(CTX, KEY, { fx: 'novelty', kind: 'coin' } as never);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors.join(' ')).toMatch(/kind/);
  });

  it('builds an audit_gap decision naming the count and the first dropped tick', () => {
    const built = gapRecord(CTX, 1, 3, 2, 90);
    expect(built.ok, JSON.stringify(built)).toBe(true);
    if (!built.ok) return;
    expect(built.event.payload.kind).toBe('audit_gap');
    expect(built.event.payload.decision_id).toBe(`body:${LIFE}:1:999:audit_gap:3`);
    expect(built.event.payload.dropped).toBe(2);
    expect(built.event.payload.since_tick).toBe(90);
  });

  it('refuses an adoption whose source is not a known one', () => {
    const built = adoptionRecord(CTX, SHEET, 'h1', 'web' as never);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors.join(' ')).toMatch(/source/);
  });
});
