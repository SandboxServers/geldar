import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type FeedSource, type KinoConn, KinoRelay } from '../../src/kino/relay.ts';
import { type Access, type AgentScope, ANONYMOUS, type ScopeStore } from '../../src/kino/scope.ts';

const OWNER: Access = { signedIn: true, admin: false, ownerId: 'o1', banned: false };
const AGENTS: Record<string, AgentScope> = {
  mine: { owner: 'o1', publicCamera: false },
  theirs: { owner: 'o2', publicCamera: false },
  shown: { owner: 'o2', publicCamera: true },
};

function store(by: Record<string, Access>): ScopeStore {
  return {
    access: async (h) => (h === null ? ANONYMOUS : (by[h] ?? ANONYMOUS)),
    agent: async (id) => AGENTS[id] ?? null,
  };
}

function rig(by: Record<string, Access> = { o: OWNER }, paneCap?: number) {
  const subs: string[] = [];
  const stopped: string[] = [];
  const feed: FeedSource = {
    subscribe: (a) => {
      subs.push(a);
      return () => stopped.push(a);
    },
  };
  const relay = new KinoRelay({ store: store(by), feed, ...(paneCap ? { paneCap } : {}) });
  return { relay, subs, stopped };
}

function conn() {
  const c = { sent: [] as string[], closed: 0 } as { sent: string[]; closed: number } & KinoConn;
  c.send = (t) => void c.sent.push(t);
  c.close = () => void c.closed++;
  return c;
}
const sub = (a: string) =>
  JSON.stringify({ type: 'subscribe', target_agent_id: a, mode: 'follow' });
const bye = (r: string) => JSON.stringify({ type: 'bye', reason: r });

async function ask(
  r: ReturnType<typeof rig>,
  id: string | null,
  agent: string,
): Promise<{ c: ReturnType<typeof conn> }> {
  const c = conn();
  const pane = r.relay.accept(c, id ?? 'anon:1', id);
  await pane?.message(sub(agent));
  return { c };
}

describe('target scope', () => {
  it('owner on own agent is allowed', async () => {
    const r = rig();
    await ask(r, 'o', 'mine');
    expect(r.subs).toEqual(['mine']);
  });
  it('owner on another agent is refused', async () => {
    const r = rig();
    const { c } = await ask(r, 'o', 'theirs');
    expect(r.subs).toEqual([]);
    expect(c.sent).toEqual([bye('target_not_permitted')]);
    expect(c.closed).toBe(1);
  });
  it('admin is allowed on any agent', async () => {
    const r = rig({ a: { ...OWNER, admin: true, ownerId: null } });
    await ask(r, 'a', 'theirs');
    expect(r.subs).toEqual(['theirs']);
  });
  it('anonymous is allowed only on a public-flagged agent', async () => {
    const r = rig();
    const yes = await ask(r, null, 'shown');
    const no = await ask(r, null, 'mine');
    expect(r.subs).toEqual(['shown']);
    expect(yes.c.closed).toBe(0);
    expect(no.c.sent).toEqual([bye('target_not_permitted')]);
  });
  it('a banned owner and an unknown agent are refused', async () => {
    const r = rig({ b: { ...OWNER, banned: true } });
    const banned = await ask(r, 'b', 'mine');
    const unknown = await ask(rig(), 'o', 'nobody');
    expect(r.subs).toEqual([]);
    expect(banned.c.sent).toEqual([bye('target_not_permitted')]);
    expect(unknown.c.sent).toEqual([bye('target_not_permitted')]);
  });
  it('forwards feed messages and stops the feed on unsubscribe', async () => {
    const r = rig();
    const c = conn();
    const pane = r.relay.accept(c, 'o', 'o');
    await pane?.message(sub('mine'));
    await pane?.message(JSON.stringify({ type: 'unsubscribe' }));
    expect(r.stopped).toEqual(['mine']);
    expect(c.sent).toEqual([bye('unsubscribed')]);
  });
});

describe('pane cap', () => {
  it('refuses the fifth pane and frees a slot on close, abort or error', () => {
    const r = rig();
    const panes = [1, 2, 3, 4].map(() => r.relay.accept(conn(), 's', 'o'));
    const fifth = conn();
    expect(r.relay.accept(fifth, 's', 'o')).toBeNull();
    expect(fifth.sent).toEqual([bye('pane_cap_reached')]);
    expect(fifth.closed).toBe(1);
    expect(r.relay.accept(conn(), 'other', 'o')).not.toBeNull();
    panes[0]?.closed();
    panes[0]?.closed();
    expect(r.relay.accept(conn(), 's', 'o')).not.toBeNull();
    expect(r.relay.accept(conn(), 's', 'o')).toBeNull();
    panes[1]?.closed();
    panes[2]?.closed();
    expect(r.relay.accept(conn(), 's', 'o')).not.toBeNull();
    expect(r.relay.accept(conn(), 's', 'o')).not.toBeNull();
    expect(r.relay.accept(conn(), 's', 'o')).toBeNull();
  });
  it('a cap setting of 3 refuses the fourth', () => {
    const r = rig({ o: OWNER }, 3);
    for (let i = 0; i < 3; i++) expect(r.relay.accept(conn(), 's', 'o')).not.toBeNull();
    expect(r.relay.accept(conn(), 's', 'o')).toBeNull();
  });
  it('a socket closed while the check runs never subscribes, and the slot is freed', async () => {
    const r = rig();
    const pane = r.relay.accept(conn(), 's', 'o');
    const p = pane?.message(sub('mine'));
    pane?.closed();
    await p;
    expect(r.subs).toEqual([]);
    expect(r.relay.openPanes).toBe(0);
  });
  it('a failing store ends the pane and frees the slot', async () => {
    const feed: FeedSource = { subscribe: () => () => {} };
    const bad: ScopeStore = {
      access: async () => {
        throw new Error('db down');
      },
      agent: async () => null,
    };
    const relay = new KinoRelay({ store: bad, feed });
    const c = conn();
    await relay.accept(c, 's', 'o')?.message(sub('mine'));
    expect(c.sent).toEqual([bye('feed_unavailable')]);
    expect(relay.openPanes).toBe(0);
  });
  it('the kill switch refuses new panes', () => {
    const relay = new KinoRelay({
      store: store({}),
      feed: { subscribe: () => () => {} },
      enabled: () => false,
    });
    const c = conn();
    expect(relay.accept(c, 's', null)).toBeNull();
    expect(c.sent).toEqual([bye('kill_switch')]);
  });
});

describe('client messages', () => {
  it.each([
    ['not json', 'hello'],
    ['unknown type', JSON.stringify({ type: 'chat', text: 'hi' })],
    [
      'extra key',
      JSON.stringify({ type: 'subscribe', target_agent_id: 'mine', mode: 'follow', x: 1 }),
    ],
    ['bad mode', JSON.stringify({ type: 'subscribe', target_agent_id: 'mine', mode: 'fly' })],
    ['bad target', JSON.stringify({ type: 'subscribe', target_agent_id: 'Mine!', mode: 'follow' })],
    ['unsubscribe with a field', JSON.stringify({ type: 'unsubscribe', x: 1 })],
    ['array', '[]'],
  ])('rejects %s and closes the socket', async (_n, text) => {
    const r = rig();
    const c = conn();
    await r.relay.accept(c, 's', 'o')?.message(text);
    expect(c.closed).toBe(1);
    expect(r.subs).toEqual([]);
    expect(r.relay.openPanes).toBe(0);
  });
});

describe('read only', () => {
  it('the kino sources import no NATS client, publish nothing and send only SELECT', () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '../../src/kino');
    for (const f of ['relay.ts', 'scope.ts', 'ws.ts']) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src).not.toMatch(/\bnats\b|\.publish\(|\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
    }
  });
});
