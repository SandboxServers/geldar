import { describe, expect, it } from 'vitest';
import {
  bookSubject,
  PRESENCE_BUCKET,
  validateBookReply,
  validateBookRequest,
  validateDayNightPayload,
  validatePresenceRecord,
  validateSovereignCallPayload,
} from '../src/index.ts';

const call = {
  player_id: 'ag-jason-01',
  tool: 'act',
  outcome: 'ok',
  accepted: [0, 1],
  rejected: [{ index: 2, reason: 'budget_exhausted' }],
  credits_charged: 2,
  budget_remaining: 238,
  thought_id: 'th_01HZX3V9Q4M2K8R7T6Y5W4E3D5',
  reasoning: 'The bread is low.',
  say: 'Hello.',
  latency_ms: 412,
};

const reply = { status: 'ok', title: 'Notes', author: 'Trini', text: 'Mind the gap.' };

const presence = {
  life_id: 'ag_jason_01',
  state: 'awake',
  desired_body: 'up',
  at: '2026-11-09T12:00:00Z',
};

const dayNight = { phase: 'dusk', tick: 12000 };

describe('sovereign call event payload', () => {
  it('accepts a valid call and rejects a token field, a bad tool or an oversized journal', () => {
    expect(validateSovereignCallPayload(call).ok).toBe(true);
    expect(validateSovereignCallPayload({ ...call, token: 'gmcp-x' }).ok).toBe(false);
    expect(validateSovereignCallPayload({ ...call, session: 'abc' }).ok).toBe(false);
    expect(validateSovereignCallPayload({ ...call, tool: 'teleport' }).ok).toBe(false);
    expect(validateSovereignCallPayload({ ...call, journal: 'x'.repeat(2001) }).ok).toBe(false);
    expect(validateSovereignCallPayload({ ...call, outcome: 'maybe' }).ok).toBe(false);
  });

  it('accepts a call with no thought, reasoning, say or journal', () => {
    const { thought_id: _t, reasoning: _r, say: _s, ...bare } = call;
    expect(validateSovereignCallPayload({ ...bare, tool: 'look', accepted: [] }).ok).toBe(true);
  });
});

describe('book request and reply', () => {
  it('accepts a life id request and rejects a wrong id or an extra field', () => {
    expect(validateBookRequest({ life_id: 'ag_jason_01' }).ok).toBe(true);
    expect(validateBookRequest({ life_id: 'ag-jason-01' }).ok).toBe(false);
    expect(validateBookRequest({ life_id: 'ag_jason_01', shard: 'phase0' }).ok).toBe(false);
  });

  it('accepts the three statuses and rejects an unknown status or an oversized text', () => {
    expect(validateBookReply(reply).ok).toBe(true);
    expect(
      validateBookReply({ ...reply, status: 'no_book', title: '', author: '', text: '' }).ok,
    ).toBe(true);
    expect(validateBookReply({ ...reply, status: 'burned' }).ok).toBe(false);
    expect(validateBookReply({ ...reply, text: 'x'.repeat(8193) }).ok).toBe(false);
    expect(validateBookReply({ ...reply, title: 'x'.repeat(65) }).ok).toBe(false);
  });
});

describe('presence record and day-night payload', () => {
  it('accepts a presence record and rejects an unknown state or a missing lease time', () => {
    expect(validatePresenceRecord(presence).ok).toBe(true);
    expect(validatePresenceRecord({ ...presence, state: 'asleep' }).ok).toBe(false);
    expect(validatePresenceRecord({ ...presence, at: undefined }).ok).toBe(false);
    expect(validatePresenceRecord({ ...presence, desired_body: 'maybe' }).ok).toBe(false);
  });

  it('accepts the four phases and rejects a fifth', () => {
    for (const phase of ['dawn', 'day', 'dusk', 'night']) {
      expect(validateDayNightPayload({ ...dayNight, phase }).ok).toBe(true);
    }
    expect(validateDayNightPayload({ ...dayNight, phase: 'noon' }).ok).toBe(false);
  });
});

describe('sovereign subjects', () => {
  it('builds the book subject from the shard and the life id', () => {
    expect(bookSubject('phase0', 'ag_jason_01')).toBe('geldar.phase0.body.ag_jason_01.book');
    expect(PRESENCE_BUCKET).toBe('geldar-presence');
  });

  it('keeps the book subject outside the sink filter geldar.*.*', () => {
    // NATS matching: a `*` token matches one token, so the filter needs exactly three tokens.
    const matches = (filter: string, subject: string): boolean => {
      const f = filter.split('.');
      const s = subject.split('.');
      return f.length === s.length && f.every((t, i) => t === '*' || t === s[i]);
    };
    expect(matches('geldar.*.*', 'geldar.phase0.phase0')).toBe(true);
    expect(matches('geldar.*.*', bookSubject('phase0', 'ag_jason_01'))).toBe(false);
  });

  it('refuses a shard or life id that could widen the subject', () => {
    expect(() => bookSubject('phase0.*', 'ag_jason_01')).toThrow();
    expect(() => bookSubject('phase0', 'ag_jason_01.>')).toThrow();
  });
});
