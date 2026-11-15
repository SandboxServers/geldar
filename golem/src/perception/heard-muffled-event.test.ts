import { hearingSubject } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { HeardMuffledInbox, PENDING_LIMIT, watchHeardMuffled } from './heard-muffled-event.ts';

const NOTICE = { kind: 'heard_muffled', direction: 'n', band: 'near' } as const;
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

  it('keeps the last allowed notice and drops the one past PENDING_LIMIT', () => {
    const inbox = new HeardMuffledInbox();
    for (let i = 0; i < PENDING_LIMIT; i += 1) expect(inbox.receive(NOTICE)).toBe(true);
    expect(inbox.receive(NOTICE)).toBe(false);
    expect(inbox.overflowCount).toBe(1);
    expect(inbox.take()).toHaveLength(PENDING_LIMIT);
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
