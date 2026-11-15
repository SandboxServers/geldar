import { hearingSubject } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { HeardMuffledInbox, MUFFLED_WINDOW_MS, watchHeardMuffled } from './heard-muffled-event.ts';
import { selectMuffledNotices } from './muffled.ts';

const NOTICE = { kind: 'heard_muffled', direction: 'n', band: 'near' } as const;
const notice = (direction: string, band: string) => ({ kind: 'heard_muffled', direction, band });
const SHARD = 'dev';
const LIFE = 'ag_ada_01';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A transport the test drives by hand: `deliver` and `fail` call the callback the Body subscribed with. */
function fakeTransport(options: { throwOnSubscribe?: boolean } = {}) {
  const subjects: string[] = [];
  let callback: ((err: unknown, msg: { data: Uint8Array }) => void) | undefined;
  let unsubscribes = 0;
  return {
    subjects,
    get unsubscribes() {
      return unsubscribes;
    },
    transport: {
      subscribe(
        subject: string,
        opts: { callback: (err: unknown, msg: { data: Uint8Array }) => void },
      ) {
        if (options.throwOnSubscribe) throw new Error('no connection');
        subjects.push(subject);
        callback = opts.callback;
        return {
          unsubscribe() {
            unsubscribes += 1;
          },
        };
      },
    },
    deliver(data: Uint8Array) {
      callback?.(null, { data });
    },
    fail(err: unknown) {
      callback?.(err, { data: new Uint8Array() });
    },
  };
}

describe('HeardMuffledInbox', () => {
  it('keeps a valid notice and shows it again on every peek until its window ends', () => {
    let now = 0;
    const inbox = new HeardMuffledInbox({ now: () => now });
    expect(inbox.receive(NOTICE)).toBe(true);
    expect(inbox.peek()).toEqual([NOTICE]);
    now = 1_000;
    expect(inbox.peek()).toEqual([NOTICE]);
  });

  it('renders nothing and does not throw when no notice ever arrived', () => {
    const inbox = new HeardMuffledInbox();
    expect(inbox.peek()).toEqual([]);
    expect(inbox.refusedCount).toBe(0);
  });

  it('drops an unknown direction code, a missing band, and payloads with extra keys (x, speaker, words)', () => {
    const inbox = new HeardMuffledInbox();
    expect(inbox.receive({ kind: 'heard_muffled', direction: 'up', band: 'near' })).toBe(false);
    expect(inbox.receive({ kind: 'heard_muffled', direction: 'n' })).toBe(false);
    expect(inbox.receive({ ...NOTICE, x: 10 })).toBe(false);
    expect(inbox.receive({ ...NOTICE, speaker: 'Ada' })).toBe(false);
    expect(inbox.receive({ ...NOTICE, words: 'meet me' })).toBe(false);
    expect(inbox.refusedCount).toBe(5);
    expect(inbox.peek()).toEqual([]);
  });

  it('refuses bytes that are not JSON without throwing', () => {
    const inbox = new HeardMuffledInbox();
    expect(inbox.receiveBytes(bytes('{not json'))).toBe(false);
    expect(inbox.refusedCount).toBe(1);
  });

  it('a flood of far notices from n never evicts a near notice from e', () => {
    const inbox = new HeardMuffledInbox({ now: () => 0 });
    for (let i = 0; i < 64; i += 1) expect(inbox.receive(notice('n', 'far'))).toBe(true);
    expect(inbox.receive(notice('e', 'near'))).toBe(true);
    expect(inbox.peek()).toEqual([notice('e', 'near'), notice('n', 'far')]);
  });

  it('keeps one entry per direction, at its nearest band, however many notices arrive', () => {
    const inbox = new HeardMuffledInbox({ now: () => 0 });
    inbox.receive(notice('n', 'far'));
    inbox.receive(notice('n', 'mid'));
    inbox.receive(notice('n', 'far'));
    expect(inbox.peek()).toEqual([notice('n', 'mid')]);
  });

  it('orders all ten directions at near in direction order, and the snapshot cap keeps the first three', () => {
    const inbox = new HeardMuffledInbox({ now: () => 0 });
    for (const direction of ['below', 'overhead', 'nw', 'w', 'sw', 's', 'se', 'e', 'ne', 'n']) {
      inbox.receive(notice(direction, 'near'));
    }
    const peeked = inbox.peek();
    expect(peeked.map((n) => n.direction)).toEqual([
      'n',
      'ne',
      'e',
      'se',
      's',
      'sw',
      'w',
      'nw',
      'overhead',
      'below',
    ]);
    expect(selectMuffledNotices(peeked).map((n) => n.direction)).toEqual(['n', 'ne', 'e']);
  });

  it('shows a notice that is exactly at the window edge, and drops one a millisecond older', () => {
    let now = 0;
    const inbox = new HeardMuffledInbox({ now: () => now });
    inbox.receive(NOTICE);
    now = MUFFLED_WINDOW_MS;
    expect(inbox.peek()).toEqual([NOTICE]);
    now = MUFFLED_WINDOW_MS + 1;
    expect(inbox.peek()).toEqual([]);
    expect(inbox.staleCount).toBe(1);
  });

  it('an equal-band arrival in the same direction does not restart the clock', () => {
    let now = 0;
    const inbox = new HeardMuffledInbox({ now: () => now });
    inbox.receive(NOTICE);
    now = 15_000;
    inbox.receive(NOTICE);
    now = 20_000;
    expect(inbox.peek()).toEqual([NOTICE]);
    now = 21_000;
    expect(inbox.peek()).toEqual([]);
  });

  it('a farther arrival in the same direction does not restart the clock either', () => {
    let now = 0;
    const inbox = new HeardMuffledInbox({ now: () => now });
    inbox.receive(notice('n', 'mid'));
    now = 15_000;
    inbox.receive(notice('n', 'far'));
    now = MUFFLED_WINDOW_MS + 1;
    expect(inbox.peek()).toEqual([]);
  });

  it('a nearer arrival replaces the entry and restarts the clock', () => {
    let now = 0;
    const inbox = new HeardMuffledInbox({ now: () => now });
    inbox.receive(notice('n', 'mid'));
    now = 15_000;
    inbox.receive(NOTICE);
    now = 30_000;
    expect(inbox.peek()).toEqual([NOTICE]);
    now = 35_001;
    expect(inbox.peek()).toEqual([]);
  });

  it('a stale near entry does not hide a fresh far notice in the same direction', () => {
    let now = 0;
    const inbox = new HeardMuffledInbox({ now: () => now });
    inbox.receive(notice('n', 'near'));
    now = MUFFLED_WINDOW_MS + 1;
    inbox.receive(notice('n', 'far'));
    expect(inbox.peek()).toEqual([notice('n', 'far')]);
  });

  it('writes at most one drop line a minute, with running counts and no payload content', () => {
    let now = 0;
    const lines: string[] = [];
    const inbox = new HeardMuffledInbox({ now: () => now, log: (line) => lines.push(line) });
    inbox.receive({ ...NOTICE, speaker: 'Ada' });
    inbox.receive({ ...NOTICE, words: 'meet me' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('refused 1');
    now = 59_999;
    inbox.receive(NOTICE);
    inbox.receive({ ...NOTICE, x: 10 });
    expect(lines).toHaveLength(1);
    now = 120_001;
    expect(inbox.peek()).toEqual([]);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('refused 3');
    expect(lines[1]).toContain('stale 1');
    expect(lines.join(' ')).not.toMatch(/Ada|meet|speaker|words/);
  });
});

describe('watchHeardMuffled', () => {
  it('subscribes to the hearing subject and keeps valid messages', () => {
    const fake = fakeTransport();
    const watch = watchHeardMuffled({
      transport: fake.transport,
      shard: SHARD,
      lifeId: LIFE,
      log: () => {},
    });
    expect(fake.subjects).toEqual([hearingSubject(SHARD, LIFE)]);
    fake.deliver(bytes(JSON.stringify(NOTICE)));
    expect(watch.inbox.peek()).toEqual([NOTICE]);
  });

  it('logs a refused message as a line with no payload content', () => {
    const fake = fakeTransport();
    const lines: string[] = [];
    const watch = watchHeardMuffled({
      transport: fake.transport,
      shard: SHARD,
      lifeId: LIFE,
      log: (line) => lines.push(line),
    });
    fake.deliver(bytes(JSON.stringify({ ...NOTICE, speaker: 'Ada' })));
    expect(watch.inbox.peek()).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines.join(' ')).not.toContain('Ada');
  });

  it('logs a subscription error through the drop limiter: one line a minute, shared with the drops', () => {
    let now = 0;
    const fake = fakeTransport();
    const lines: string[] = [];
    watchHeardMuffled({
      transport: fake.transport,
      shard: SHARD,
      lifeId: LIFE,
      log: (line) => lines.push(line),
      now: () => now,
    });
    fake.fail(new Error('connection lost'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('subscription error');
    expect(lines[0]).toContain('connection lost');
    fake.deliver(bytes(JSON.stringify({ ...NOTICE, speaker: 'Ada' })));
    now = 1_000;
    fake.fail(new Error('connection lost'));
    expect(lines).toHaveLength(1);
    now = 60_000;
    fake.fail(new Error('connection lost'));
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('refused 1');
    expect(lines.join(' ')).not.toContain('Ada');
  });

  it('stays empty and does not throw when there is no transport (plugin or NATS not present)', () => {
    const lines: string[] = [];
    const watch = watchHeardMuffled({
      transport: undefined,
      shard: SHARD,
      lifeId: LIFE,
      log: (l) => lines.push(l),
    });
    expect(watch.inbox.peek()).toEqual([]);
    expect(() => watch.stop()).not.toThrow();
    expect(lines).toEqual([]);
  });

  it('stays empty, logs once, and does not throw when the subscribe fails', () => {
    const fake = fakeTransport({ throwOnSubscribe: true });
    const lines: string[] = [];
    let watch: ReturnType<typeof watchHeardMuffled> | undefined;
    expect(() => {
      watch = watchHeardMuffled({
        transport: fake.transport,
        shard: SHARD,
        lifeId: LIFE,
        log: (l) => lines.push(l),
      });
    }).not.toThrow();
    expect(watch?.inbox.peek()).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(() => watch?.stop()).not.toThrow();
  });

  it('ignores a message that arrives after stop, and unsubscribes once', () => {
    const fake = fakeTransport();
    const watch = watchHeardMuffled({
      transport: fake.transport,
      shard: SHARD,
      lifeId: LIFE,
      log: () => {},
    });
    watch.stop();
    watch.stop();
    fake.deliver(bytes(JSON.stringify(NOTICE)));
    expect(watch.inbox.peek()).toEqual([]);
    expect(fake.unsubscribes).toBe(1);
  });
});
