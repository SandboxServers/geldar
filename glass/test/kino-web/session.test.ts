import { describe, expect, it } from 'vitest';
import { watchableIds } from '../../src/kino/scope.ts';
import type { FeedState } from '../../web/kino/feed.ts';
import { byeText, KinoSession, type Refusal, type SocketLike } from '../../web/kino/session.ts';
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

function hello(agent: string) {
  return { type: 'hello', feed_version: 1, world: 'w', target_agent_id: agent, view_radius: 2 };
}

function section(x: number) {
  return {
    type: 'chunk_section',
    chunk_x: x,
    chunk_z: 0,
    section_y: 0,
    palette: ['minecraft:air'],
    bits: 0,
    data: '',
  };
}

/** A session with an open socket that records resets, refusals and the world on screen. */
function race() {
  const socks: FakeSocket[] = [];
  const resets: string[] = [];
  const refusals: Refusal[] = [];
  let state: FeedState | null = null;
  const s = new KinoSession(
    () => {
      const f = new FakeSocket();
      socks.push(f);
      f.onopen = null;
      return f;
    },
    {
      onReset: (st, agent) => {
        resets.push(agent);
        state = st;
      },
      onChange: () => undefined,
      onEnd: () => undefined,
      onRefused: (x) => refusals.push(x),
    },
  );
  return {
    s,
    resets,
    refusals,
    get sock(): FakeSocket {
      const f = socks[0] as FakeSocket;
      f.onopen?.();
      return f;
    },
    world: () => (state as FeedState | null)?.world.keys().sort() ?? [],
  };
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

  it('resets the world for a new target only, once the server confirms it (decision 0166)', () => {
    const { s, socks, log } = setup();
    s.subscribe('a_bot', 'follow');
    s.subscribe('a_bot', 'free');
    s.subscribe('b_bot', 'free');
    // The old world stays until the server's hello names the new agent.
    expect(log.resets).toBe(1);
    expect(s.current).toEqual({ shown: 'a_bot', confirmed: false, wanted: 'b_bot' });
    socks[0]?.feed(hello('b_bot'));
    expect(log.resets).toBe(2);
    expect(s.current).toEqual({ shown: 'b_bot', confirmed: true, wanted: 'b_bot' });
  });

  it('keeps the old agent when the server refuses a retune, and can retune again', () => {
    const r = race();
    r.s.subscribe('a_bot', 'follow');
    r.sock.feed(hello('a_bot'));
    r.sock.feed(section(0));
    r.s.subscribe('b_bot', 'follow');
    r.sock.feed({ type: 'rate_limited' });
    expect(r.refusals).toEqual([{ kind: 'retune', kept: 'a_bot', refused: 'b_bot' }]);
    expect(r.resets).toEqual(['a_bot']);
    expect(r.s.current).toEqual({ shown: 'a_bot', confirmed: true, wanted: 'a_bot' });
    // A's world was not thrown away, and A's feed keeps landing in it.
    r.sock.feed(section(1));
    expect(r.world()).toEqual(['0,0,0', '1,0,0']);
    r.s.subscribe('b_bot', 'follow');
    expect(JSON.parse(r.sock.sent.at(-1) as string)).toEqual({
      type: 'subscribe',
      target_agent_id: 'b_bot',
      mode: 'follow',
    });
  });

  it('never mixes two worlds when a second retune comes while one is pending', () => {
    const r = race();
    r.s.subscribe('a_bot', 'follow');
    r.sock.feed(hello('a_bot'));
    r.sock.feed(section(0));
    r.s.subscribe('b_bot', 'follow');
    r.s.subscribe('c_bot', 'follow');
    // The server answers the first retune: B's world is its own, never A's.
    r.sock.feed(hello('b_bot'));
    r.sock.feed(section(5));
    expect(r.resets).toEqual(['a_bot', 'b_bot']);
    expect(r.world()).toEqual(['5,0,0']);
    // Then the second: C starts empty.
    r.sock.feed(hello('c_bot'));
    r.sock.feed(section(9));
    expect(r.resets).toEqual(['a_bot', 'b_bot', 'c_bot']);
    expect(r.world()).toEqual(['9,0,0']);
    expect(r.s.current).toEqual({ shown: 'c_bot', confirmed: true, wanted: 'c_bot' });
  });

  it('never mixes worlds when the viewer goes back to the current agent while a retune is pending', () => {
    const r = race();
    r.s.subscribe('a_bot', 'follow');
    r.sock.feed(hello('a_bot'));
    r.sock.feed(section(0));
    r.s.subscribe('b_bot', 'follow');
    r.s.subscribe('a_bot', 'follow');
    r.sock.feed(hello('b_bot'));
    r.sock.feed(section(5));
    expect(r.world()).toEqual(['5,0,0']);
    r.sock.feed(hello('a_bot'));
    r.sock.feed(section(0));
    expect(r.world()).toEqual(['0,0,0']);
    expect(r.s.current).toEqual({ shown: 'a_bot', confirmed: true, wanted: 'a_bot' });
  });

  it('a refusal after the server moved on keeps the agent really shown, not the one before', () => {
    const r = race();
    r.s.subscribe('a_bot', 'follow');
    r.sock.feed(hello('a_bot'));
    r.s.subscribe('b_bot', 'follow');
    r.s.subscribe('c_bot', 'follow');
    r.sock.feed(hello('b_bot'));
    r.sock.feed({ type: 'rate_limited' });
    expect(r.refusals).toEqual([{ kind: 'retune', kept: 'b_bot', refused: 'c_bot' }]);
    expect(r.s.current).toEqual({ shown: 'b_bot', confirmed: true, wanted: 'b_bot' });
  });

  it('a refusal it read wrongly heals when the server names the agent it is sending', () => {
    const r = race();
    r.s.subscribe('a_bot', 'follow');
    r.sock.feed(hello('a_bot'));
    r.s.subscribe('a_bot', 'orbit'); // a mode change the server refuses...
    r.s.subscribe('b_bot', 'orbit'); // ...and a retune it accepts
    r.sock.feed({ type: 'rate_limited' });
    expect(r.s.current.wanted).toBe('a_bot');
    r.sock.feed(hello('b_bot'));
    expect(r.s.current).toEqual({ shown: 'b_bot', confirmed: true, wanted: 'b_bot' });
  });

  it('reports a refused first subscribe, and a refused mode change, apart from a retune', () => {
    const r = race();
    r.s.subscribe('a_bot', 'follow');
    r.sock.feed({ type: 'rate_limited' });
    expect(r.refusals).toEqual([{ kind: 'open', agent: 'a_bot' }]);
    r.s.subscribe('a_bot', 'follow');
    r.sock.feed(hello('a_bot'));
    r.s.subscribe('a_bot', 'free');
    r.sock.feed({ type: 'rate_limited' });
    expect(r.refusals.at(-1)).toEqual({ kind: 'mode' });
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
    ).toEqual({ enabled: true, signedIn: true, agents: [{ id: 'a_bot', label: 'a_bot' }] });
    expect(parseTargets(null)).toEqual({ enabled: true, signedIn: false, agents: [] });
    expect(parseTargets({ enabled: false }).enabled).toBe(false);
  });

  it('asks an anonymous viewer to sign in, and still lists public cameras', () => {
    expect(targetsNotice({ enabled: true, signedIn: false, agents: [] })).toMatch(/Sign in/);
    expect(
      targetsNotice({ enabled: true, signedIn: false, agents: [{ id: 'a_bot', label: 'a_bot' }] }),
    ).toMatch(/Sign in/);
    expect(
      targetsNotice({ enabled: true, signedIn: true, agents: [{ id: 'a_bot', label: 'a_bot' }] }),
    ).toBeNull();
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
