import { describe, expect, it } from 'vitest';
import { KinoKillSwitch } from '../../src/kino/killswitch.ts';
import { KinoMetrics } from '../../src/kino/metrics.ts';
import { type FeedSource, type KinoConn, KinoRelay } from '../../src/kino/relay.ts';
import { ANONYMOUS, type ScopeStore } from '../../src/kino/scope.ts';

const store: ScopeStore = {
  access: async () => ANONYMOUS,
  agent: async () => ({ owner: 'o2', publicCamera: true }),
};

function rig(on: boolean) {
  const sw = new KinoKillSwitch(on);
  const metrics = new KinoMetrics();
  const pushes: Array<(j: string) => void> = [];
  const feed: FeedSource = {
    subscribe: (_a, f) => {
      pushes.push(f);
      return () => {};
    },
  };
  const relay = new KinoRelay({
    store,
    feed,
    enabled: sw.enabled,
    onPanes: metrics.onPanes,
    onBytes: metrics.onBytes,
    onRefusal: metrics.onRefusal,
  });
  sw.attach(relay);
  return { sw, metrics, relay, pushes };
}

function conn() {
  const c = { sent: [] as string[], closed: 0 } as { sent: string[]; closed: number } & KinoConn;
  c.send = (t) => void c.sent.push(t);
  c.close = () => void c.closed++;
  return c;
}
const sub = JSON.stringify({ type: 'subscribe', target_agent_id: 'shown', mode: 'follow' });
const bye = JSON.stringify({ type: 'bye', reason: 'kill_switch' });

describe('kill switch', () => {
  it('refuses a new pane while off, then allows it after flipping back', () => {
    const r = rig(false);
    const c = conn();
    expect(r.relay.accept(c, 'anon:1', null)).toBeNull();
    expect(c.sent).toEqual([bye]);
    expect(c.closed).toBe(1);
    r.sw.set(true);
    expect(r.relay.accept(conn(), 'anon:1', null)).not.toBeNull();
  });
  it('sends bye and closes live panes when flipped off', async () => {
    const r = rig(true);
    const c = conn();
    const pane = r.relay.accept(c, 'anon:1', null);
    await pane?.message(sub);
    r.sw.set(false);
    expect(c.sent).toEqual([bye]);
    expect(c.closed).toBe(1);
    expect(r.relay.openPanes).toBe(0);
    r.pushes[0]?.('late');
    expect(c.sent).toEqual([bye]);
    r.sw.set(false);
    expect(c.sent).toEqual([bye]);
  });
  it('a subscribe on a live pane after the flip gets bye kill_switch', async () => {
    const r = rig(true);
    const c = conn();
    const pane = r.relay.accept(c, 'anon:1', null);
    (r.sw as unknown as { on: boolean }).on = false;
    await pane?.message(sub);
    expect(c.sent).toEqual([bye]);
  });
});

describe('metrics', () => {
  it('counts panes, bytes and refusals by reason only', async () => {
    const r = rig(true);
    const pane = r.relay.accept(conn(), 'anon:1', null);
    await pane?.message(sub);
    r.pushes[0]?.('abcde');
    expect(r.metrics.snapshot()).toEqual({ panes_open: 1, bytes_sent: 5, refusals: {} });
    r.sw.set(false);
    r.relay.accept(conn(), 'anon:2', null);
    const snap = r.metrics.snapshot();
    expect(snap.panes_open).toBe(0);
    expect(snap.refusals).toEqual({ kill_switch: 2 });
  });
  it('has no agent, login or account label', async () => {
    const r = rig(true);
    const pane = r.relay.accept(conn(), 'someone-hash', 'someone-hash');
    await pane?.message(sub);
    r.sw.set(false);
    const text = JSON.stringify(r.metrics.snapshot());
    expect(text).not.toContain('shown');
    expect(text).not.toContain('someone');
    expect(Object.keys(r.metrics.snapshot()).sort()).toEqual([
      'bytes_sent',
      'panes_open',
      'refusals',
    ]);
  });
});
