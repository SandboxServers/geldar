import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { controlledFeed, controlSubject } from './control.ts';
import type { FeedSource } from './relay.ts';

let sent: Array<{ type: string; target_agent_id: string; control_version: number }>;
let on: boolean;
let innerSubs: number;
const inner: FeedSource = {
  subscribe() {
    innerSubs++;
    return () => {
      innerSubs--;
    };
  },
};
const make = () =>
  controlledFeed(inner, {
    sink: { publish: (j) => sent.push(JSON.parse(j)) },
    enabled: () => on,
    graceMs: 1000,
    refreshMs: 5000,
  });
const types = () => sent.map((m) => m.type);

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  on = true;
  innerSubs = 0;
});
afterEach(() => vi.useRealTimers());

describe('Kino control publisher', () => {
  it('names the control subject and rejects a bad shard', () => {
    expect(controlSubject('phase0')).toBe('geldar.phase0.kino.control');
    expect(() => controlSubject('a.b')).toThrow();
  });

  it('publishes start for the first pane only, resync for later ones', () => {
    const f = make();
    f.subscribe('kestrel_01', () => {});
    f.subscribe('kestrel_01', () => {});
    expect(types()).toEqual(['start', 'resync']);
    expect(sent[0]).toEqual({
      control_version: 1,
      type: 'start',
      target_agent_id: 'kestrel_01',
    });
    f.dispose();
  });

  it('publishes stop only after the last pane leaves, and after the grace', () => {
    const f = make();
    const a = f.subscribe('kestrel_01', () => {});
    const b = f.subscribe('kestrel_01', () => {});
    a();
    a(); // idempotent
    vi.advanceTimersByTime(5000 - 1);
    expect(types()).not.toContain('stop');
    b();
    vi.advanceTimersByTime(999);
    expect(types()).not.toContain('stop');
    vi.advanceTimersByTime(1);
    expect(types().filter((t) => t === 'stop')).toHaveLength(1);
    expect(innerSubs).toBe(0);
    // After the stop the heartbeat is gone and a new pane starts fresh.
    sent = [];
    vi.advanceTimersByTime(60_000);
    expect(sent).toEqual([]);
    f.subscribe('kestrel_01', () => {});
    expect(types()).toEqual(['start']);
    f.dispose();
  });

  it('a pane that returns inside the grace cancels the stop and asks for a resync', () => {
    const f = make();
    f.subscribe('kestrel_01', () => {})();
    vi.advanceTimersByTime(500);
    f.subscribe('kestrel_01', () => {});
    vi.advanceTimersByTime(5000);
    expect(types()).toEqual(['start', 'resync', 'refresh']);
    f.dispose();
  });

  it('keeps agents apart and heartbeats while watched', () => {
    const f = make();
    const a = f.subscribe('a_bot', () => {});
    f.subscribe('b_bot', () => {});
    a();
    vi.advanceTimersByTime(1000);
    expect(sent.filter((m) => m.type === 'stop').map((m) => m.target_agent_id)).toEqual(['a_bot']);
    sent = [];
    vi.advanceTimersByTime(5000);
    expect(sent.map((m) => [m.type, m.target_agent_id])).toEqual([['refresh', 'b_bot']]);
    f.dispose();
  });

  it('publishes nothing while the kill switch is off, and the feed still passes through', () => {
    on = false;
    const f = make();
    const un = f.subscribe('kestrel_01', () => {});
    expect(innerSubs).toBe(1);
    un();
    vi.advanceTimersByTime(60_000);
    expect(sent).toEqual([]);
    on = true;
    f.subscribe('kestrel_01', () => {});
    expect(types()).toEqual(['start']);
    f.dispose();
  });

  it('dispose clears timers', () => {
    const f = make();
    f.subscribe('kestrel_01', () => {});
    f.dispose();
    sent = [];
    vi.advanceTimersByTime(60_000);
    expect(sent).toEqual([]);
  });
});
