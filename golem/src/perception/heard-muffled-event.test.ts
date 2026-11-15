import { heardMuffledSentence, hearingSubject } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { HeardMuffledInbox, NOTICE_TTL_MS, watchHeardMuffled } from './heard-muffled-event.ts';
import { renderMuffledLines } from './muffled.ts';

const NOTICE = { kind: 'heard_muffled', direction: 'n', band: 'near' } as const;
const notice = (direction: string, band: string) => ({ kind: 'heard_muffled', direction, band });
const SHARD = 'dev';
const LIFE = 'ag_ada_01';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A transport the test drives by hand: `deliver` calls the callback the Body subscribed with. */
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
  };
}

describe('HeardMuffledInbox', () => {
  it('keeps a valid notice and clears it on take, so it renders in one snapshot only', () => {
    const inbox = new HeardMuffledInbox();
    expect(inbox.receive(NOTICE)).toBe(true);
    expect(inbox.take()).toEqual([NOTICE]);
    expect(inbox.take()).toEqual([]);
  });

  it('renders nothing and does not throw when no notice ever arrived', () => {
    const inbox = new HeardMuffledInbox();
    expect(inbox.take()).toEqual([]);
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
    expect(inbox.take()).toEqual([]);
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
    const taken = inbox.take();
    expect(taken).toEqual([notice('e', 'near'), notice('n', 'far')]);
    expect(renderMuffledLines(taken)[0]).toBe(heardMuffledSentence('e', 'near'));
  });

  it('keeps one entry per direction, at its nearest band, however many notices arrive', () => {
    const inbox = new HeardMuffledInbox({ now: () => 0 });
    inbox.receive(notice('n', 'far'));
    inbox.receive(notice('n', 'mid'));
    inbox.receive(notice('n', 'far'));
    expect(inbox.take()).toEqual([notice('n', 'mid')]);
  });

  it('renders a notice that is exactly 60 seconds old, and drops one older', () => {
    let now = 0;
    const inbox = new HeardMuffledInbox({ now: () => now });
    inbox.receive(NOTICE);
    now = NOTICE_TTL_MS;
    expect(inbox.take()).toEqual([NOTICE]);
    inbox.receive(NOTICE);
    now = NOTICE_TTL_MS * 2 + 1;
    expect(inbox.take()).toEqual([]);
    expect(inbox.staleCount).toBe(1);
  });

  it('a stale near entry does not hide a fresh far notice in the same direction', () => {
    let now = 0;
    const inbox = new HeardMuffledInbox({ now: () => now });
    inbox.receive(notice('n', 'near'));
    now = NOTICE_TTL_MS + 1;
    inbox.receive(notice('n', 'far'));
    expect(inbox.take()).toEqual([notice('n', 'far')]);
  });

  it('take clears the inbox', () => {
    const inbox = new HeardMuffledInbox({ now: () => 0 });
    inbox.receive(NOTICE);
    expect(inbox.take()).toEqual([NOTICE]);
    expect(inbox.take()).toEqual([]);
  });

  it('peek returns the notices without clearing them, and ack clears exactly those', () => {
    const inbox = new HeardMuffledInbox({ now: () => 0 });
    inbox.receive(NOTICE);
    const peeked = inbox.peek();
    expect(peeked.notices).toEqual([NOTICE]);
    expect(inbox.peek().notices).toEqual([NOTICE]);
    peeked.ack();
    expect(inbox.take()).toEqual([]);
  });

  it('a notice that arrives between peek and ack survives the ack, in the same direction or another', () => {
    const inbox = new HeardMuffledInbox({ now: () => 0 });
    inbox.receive(notice('n', 'mid'));
    const peeked = inbox.peek();
    inbox.receive(notice('n', 'near'));
    inbox.receive(notice('e', 'far'));
    peeked.ack();
    expect(inbox.take()).toEqual([notice('n', 'near'), notice('e', 'far')]);
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
    expect(inbox.take()).toEqual([]);
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
    expect(watch.inbox.take()).toEqual([NOTICE]);
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
    expect(watch.inbox.take()).toEqual([]);
    expect(lines).toHaveLength(1);
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
    expect(watch.inbox.take()).toEqual([]);
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
    expect(watch?.inbox.take()).toEqual([]);
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
    expect(watch.inbox.take()).toEqual([]);
    expect(fake.unsubscribes).toBe(1);
  });
});
