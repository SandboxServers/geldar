import type { CharacterSheet, WorldEvent } from '@geldar/contract';
import { type DrawKey, rngFor, roll, STANDARD_SHEET } from '@geldar/psyche';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventPublisher } from '../body/records-nats.ts';
import { rollEventId } from './audit-events.ts';
import { AuditPublisher, type AuditPublisherOptions } from './audit-publisher.ts';

const LIFE = 'ag_kestrel_01';
const BASE: DrawKey = {
  lifeId: LIFE,
  producer: 'body',
  generation: 1,
  tick: 10,
  fx: 'novelty',
  decisionSeq: 0,
};
const SHEET = STANDARD_SHEET as unknown as CharacterSheet;
const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);

let clockTick = 15;

interface Sent {
  subject: string;
  body: string;
  msgId: string;
}

/** Records every publish that gets through. `failNext` fails the next N calls; `failSubject` fails one subject. */
class FakePublisher implements EventPublisher {
  readonly sent: Sent[] = [];
  attempts = 0;
  failNext = 0;
  failSubject: string | null = null;
  hold: Promise<void> | null = null;

  publish(subject: string, body: string, msgId: string): Promise<void> {
    this.attempts++;
    if (this.failNext > 0) {
      this.failNext--;
      return Promise.reject(new Error('nats down'));
    }
    if (this.failSubject === subject) return Promise.reject(new Error('subject refused'));
    const record = () => {
      this.sent.push({ subject, body, msgId });
    };
    if (this.hold) return this.hold.then(record);
    record();
    return Promise.resolve();
  }
}

function make(
  publisher: EventPublisher,
  extra: Partial<AuditPublisherOptions> = {},
  log = vi.fn(),
) {
  return new AuditPublisher({
    publisher,
    shard: 'phase0',
    lifeId: LIFE,
    generation: 1,
    tick: () => clockTick,
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    retryDelayMs: 1,
    maxRetryDelayMs: 2,
    log,
    ...extra,
  });
}

function keyAt(tick: number): DrawKey {
  return { ...BASE, tick };
}

function rollAt(key: DrawKey) {
  return roll(key.fx, 3, 11, rngFor(key));
}

function typesOf(pub: FakePublisher): string[] {
  return pub.sent.map((s) => (JSON.parse(s.body) as WorldEvent).type);
}

beforeEach(() => {
  clockTick = 15;
});

describe('stable ids', () => {
  it('gives one id for the same key, and the stream sees the same message id twice', async () => {
    const pub = new FakePublisher();
    const audit = make(pub);
    const key = keyAt(10);
    const first = audit.recordRoll(key, rollAt(key), 0);
    const second = audit.recordRoll(key, rollAt(key), 0);
    await audit.flush();
    expect(first).toBe(second);
    expect(first).toBe(rollEventId(key, 0));
    expect(pub.sent.map((s) => s.msgId)).toEqual([first, first]);
  });
});

describe('retries and recovery', () => {
  it('a failing then recovering publisher delivers each event exactly once', async () => {
    const pub = new FakePublisher();
    pub.failNext = 2;
    const audit = make(pub);
    const a = audit.recordRoll(keyAt(10), rollAt(keyAt(10)), 0);
    const b = audit.recordRoll(keyAt(11), rollAt(keyAt(11)), 0);
    await audit.flush();
    expect(pub.sent.map((s) => s.msgId)).toEqual([a, b]);
    expect(pub.attempts).toBe(4);
    expect(audit.gaps).toBe(0);
  });
});

describe('bounded queue and gap evidence', () => {
  it('a full queue drops the oldest and reports one gap with the right count and tick', async () => {
    const pub = new FakePublisher();
    let open: () => void = () => {};
    pub.hold = new Promise<void>((resolve) => {
      open = resolve;
    });
    const audit = make(pub, { maxPending: 2 });
    const ids = [10, 11, 12, 13, 14].map((tick) =>
      audit.recordRoll(keyAt(tick), rollAt(keyAt(tick)), 0),
    );
    clockTick = 15;
    open();
    await audit.flush();
    // A (in flight) goes out; then the gap; then D and E, the two newest. B and C were dropped.
    expect(typesOf(pub)).toEqual(['roll', 'decision', 'roll', 'roll']);
    expect(pub.sent.map((s) => s.msgId)[0]).toBe(ids[0]);
    expect(pub.sent.map((s) => s.msgId).slice(2)).toEqual([ids[3], ids[4]]);
    const gap = JSON.parse(pub.sent[1]?.body ?? '{}') as WorldEvent;
    expect(gap.payload.kind).toBe('audit_gap');
    expect(gap.payload.dropped).toBe(2);
    expect(gap.payload.since_tick).toBe(11);
    expect(gap.payload.decision_id).toBe(`body:${LIFE}:1:15:audit_gap:2`);
    expect(audit.gaps).toBe(2);
  });

  it('a burst of 5000 calls on a hung publisher returns each time and keeps 2000 waiting', () => {
    const pub = new FakePublisher();
    pub.hold = new Promise<void>(() => {});
    const audit = make(pub);
    for (let i = 0; i < 5000; i++) {
      const key = keyAt(i);
      expect(() => audit.recordRoll(key, rollAt(key), 0)).not.toThrow();
    }
    // one in flight, 2000 waiting, the other 2999 dropped
    expect(audit.gaps).toBe(2999);
    expect(pub.sent).toEqual([]);
  });

  it('a failed gap report is merged back and sent after the next successful publish', async () => {
    const pub = new FakePublisher();
    let open: () => void = () => {};
    pub.hold = new Promise<void>((resolve) => {
      open = resolve;
    });
    const audit = make(pub, { maxPending: 1 });
    audit.recordRoll(keyAt(10), rollAt(keyAt(10)), 0);
    audit.recordRoll(keyAt(11), rollAt(keyAt(11)), 0);
    audit.recordRoll(keyAt(12), rollAt(keyAt(12)), 0);
    pub.failSubject = 'geldar.phase0.decision';
    open();
    await audit.flush();
    expect(typesOf(pub)).toEqual(['roll', 'roll']);
    pub.failSubject = null;
    audit.recordRoll(keyAt(13), rollAt(keyAt(13)), 0);
    await audit.flush();
    expect(typesOf(pub)).toEqual(['roll', 'roll', 'roll', 'decision']);
    const gap = JSON.parse(pub.sent[3]?.body ?? '{}') as WorldEvent;
    expect(gap.payload.dropped).toBe(1);
    expect(gap.payload.since_tick).toBe(11);
  });
});

describe('failing publishers', () => {
  it('a closed or throwing publisher never throws to the caller', async () => {
    const throwing: EventPublisher = {
      publish: () => {
        throw new Error('closed');
      },
    };
    const rejecting: EventPublisher = { publish: () => Promise.reject(new Error('closed')) };
    for (const publisher of [throwing, rejecting]) {
      const audit = make(publisher);
      expect(() => {
        audit.recordRoll(keyAt(10), rollAt(keyAt(10)), 0);
        audit.recordDecision(keyAt(10), {
          fx: 'novelty',
          kind: 'uniform',
          result: { uniform: 0.25 },
        });
        audit.recordAdoption(SHEET, H1, 'config');
      }).not.toThrow();
      expect(audit.gaps).toBe(0);
    }
  });

  it('a malformed roll is dropped and logged, and nothing is published for it', async () => {
    const pub = new FakePublisher();
    const log = vi.fn();
    const audit = make(pub, {}, log);
    const key = keyAt(10);
    const id = audit.recordRoll(key, { ...rollAt(key), dice: [1, 2, 3] }, 0);
    await audit.flush();
    expect(id).toBe(rollEventId(key, 0));
    expect(pub.sent).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/dropped roll/));
  });

  it('a decision and an adoption go out on their own subjects', async () => {
    const pub = new FakePublisher();
    const audit = make(pub);
    audit.recordDecision(keyAt(10), { fx: 'novelty', kind: 'uniform', result: { uniform: 0.25 } });
    audit.recordAdoption(SHEET, H2, 'birth');
    await audit.flush();
    expect(pub.sent.map((s) => s.subject)).toEqual([
      'geldar.phase0.decision',
      'geldar.phase0.sheet_adopted',
    ]);
  });
});
