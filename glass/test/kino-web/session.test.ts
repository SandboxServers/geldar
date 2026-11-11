import { describe, expect, it } from 'vitest';
import { watchableIds } from '../../src/kino/scope.ts';
import { byeText, KinoSession, type SocketLike } from '../../web/kino/session.ts';
import { parseTargets, targetsNotice } from '../../web/kino/targets.ts';

class FakeSocket implements SocketLike {
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  send(t: string) {
    this.sent.push(t);
  }
  close() {
    this.closed = true;
  }
  feed(m: unknown) {
    this.onmessage?.({ data: typeof m === 'string' ? m : JSON.stringify(m) });
  }
}

function setup() {
  const socks: FakeSocket[] = [];
  const log = { resets: 0, ends: [] as string[], changes: 0 };
  const s = new KinoSession(
    () => {
      const f = new FakeSocket();
      socks.push(f);
      return f;
    },
    {
      onReset: () => log.resets++,
      onChange: () => log.changes++,
      onEnd: (r) => log.ends.push(r),
    },
  );
  return { s, socks, log };
}

describe('KinoSession', () => {
  it('queues the subscribe until open and sends only schema messages', () => {
    const { s, socks } = setup();
    s.subscribe('kestrel_01', 'follow');
    expect(socks[0]?.sent).toEqual([]);
    socks[0]?.onopen?.();
    s.subscribe('kestrel_01', 'orbit');
    s.unsubscribe();
    expect(socks[0]?.sent.map((t) => JSON.parse(t))).toEqual([
      { type: 'subscribe', target_agent_id: 'kestrel_01', mode: 'follow' },
      { type: 'subscribe', target_agent_id: 'kestrel_01', mode: 'orbit' },
      { type: 'unsubscribe' },
    ]);
  });

  it('resets the world for a new target only', () => {
    const { s, log } = setup();
    s.subscribe('a_bot', 'follow');
    s.subscribe('a_bot', 'free');
    s.subscribe('b_bot', 'free');
    expect(log.resets).toBe(2);
  });

  it('ends on kill_switch and on any bye but unsubscribed', () => {
    const { s, socks, log } = setup();
    s.subscribe('a_bot', 'follow');
    socks[0]?.onopen?.();
    socks[0]?.feed({ type: 'bye', reason: 'kill_switch' });
    expect(log.ends).toEqual(['kill_switch']);
    expect(socks[0]?.closed).toBe(true);
    expect(s.isEnded).toBe(true);
    s.subscribe('a_bot', 'follow'); // an ended session stays ended
    expect(socks).toHaveLength(1);
  });

  it('keeps the socket after a bye of unsubscribed', () => {
    const { s, socks, log } = setup();
    s.subscribe('a_bot', 'follow');
    socks[0]?.feed({ type: 'bye', reason: 'unsubscribed' });
    expect(log.ends).toEqual([]);
    expect(socks[0]?.closed).toBe(false);
  });

  it('reports a dropped socket once, and ignores junk and binary frames', () => {
    const { s, socks, log } = setup();
    s.subscribe('a_bot', 'follow');
    socks[0]?.feed('not json');
    socks[0]?.feed('{"no":"type"}');
    socks[0]?.onmessage?.({ data: new ArrayBuffer(2) });
    expect(log.changes).toBe(0);
    socks[0]?.onclose?.();
    socks[0]?.onclose?.();
    expect(log.ends).toEqual(['disconnected']);
  });

  it('close() does not report an end', () => {
    const { s, socks, log } = setup();
    s.subscribe('a_bot', 'follow');
    s.close();
    socks[0]?.onclose?.();
    expect(log.ends).toEqual([]);
  });

  it('has a text for the kill switch', () => {
    expect(byeText('kill_switch')).toContain('switched off');
  });
});

describe('targets', () => {
  it('parses a reply and drops bad agent ids', () => {
    expect(
      parseTargets({ signed_in: true, enabled: true, agents: ['a_bot', 'Bad Id', 3] }),
    ).toEqual({ enabled: true, signedIn: true, agents: ['a_bot'] });
    expect(parseTargets(null)).toEqual({ enabled: true, signedIn: false, agents: [] });
    expect(parseTargets({ enabled: false }).enabled).toBe(false);
  });

  it('asks an anonymous viewer to sign in, and still lists public cameras', () => {
    expect(targetsNotice({ enabled: true, signedIn: false, agents: [] })).toMatch(/Sign in/);
    expect(targetsNotice({ enabled: true, signedIn: false, agents: ['a_bot'] })).toMatch(/Sign in/);
    expect(targetsNotice({ enabled: true, signedIn: true, agents: ['a_bot'] })).toBeNull();
    expect(targetsNotice({ enabled: false, signedIn: true, agents: [] })).toMatch(/off/);
  });

  it('the server lists only what the viewer may watch', () => {
    const agents = [
      { id: 'pub_bot', publicCamera: true },
      { id: 'mine_bot', publicCamera: false },
      { id: 'theirs_bot', publicCamera: false },
    ];
    const owned = new Set(['mine_bot']);
    const anon = { signedIn: false, admin: false, ownerId: null, banned: false };
    expect(watchableIds(anon, agents)).toEqual(['pub_bot']);
    // an owned set without a sign-in grants nothing
    expect(watchableIds(anon, agents, owned)).toEqual(['pub_bot']);
    expect(watchableIds({ ...anon, signedIn: true, ownerId: 'o2' }, agents, owned)).toEqual([
      'pub_bot',
      'mine_bot',
    ]);
    expect(watchableIds({ ...anon, signedIn: true, admin: true }, agents)).toHaveLength(3);
    expect(
      watchableIds({ ...anon, signedIn: true, ownerId: 'o2', banned: true }, agents, owned),
    ).toEqual([]);
  });
});
