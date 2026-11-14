// Decision 0166, review: one monitor's tune-in life in happy-dom with a stand-in renderer. A refused or
// unanswered tune-in is shown with a way to try again, a refused retune keeps the right label, surfing
// sends once, and a closed monitor gives its WebGL context back.

import { Window } from 'happy-dom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PaneDeps } from '../../web/kino/panes/pane-view.ts';
import type { SocketLike } from '../../web/kino/session.ts';

/** The renderer a pane draws with (the test's stand-in, typed as the real one). */
type Renderer = ReturnType<NonNullable<PaneDeps['renderer']>>;
/** KinoScene makes its own material when given none; the test needs no shared atlas. */
const NO_MATERIAL = undefined as unknown as PaneDeps['atlas']['material'];

let win: Window;
let paneMod: typeof import('../../web/kino/panes/pane-view.ts');
let monitorMod: typeof import('../../web/kino/panes/monitor.ts');
let gateMod: typeof import('../../web/kino/panes/subscribe-gate.ts');

beforeAll(async () => {
  win = new Window({ url: 'https://glass.example.test/kino/' });
  const g = globalThis as Record<string, unknown>;
  g.document = win.document;
  g.HTMLElement = win.HTMLElement;
  paneMod = await import('../../web/kino/panes/pane-view.ts');
  monitorMod = await import('../../web/kino/panes/monitor.ts');
  gateMod = await import('../../web/kino/panes/subscribe-gate.ts');
});

afterAll(async () => {
  const g = globalThis as Record<string, unknown>;
  delete g.document;
  delete g.HTMLElement;
  await win.happyDOM.close();
});

class FakeSocket implements SocketLike {
  sent: { type: string; target_agent_id?: string; mode?: string }[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  send(t: string) {
    this.sent.push(JSON.parse(t));
  }
  close() {
    this.closed = true;
  }
  feed(m: unknown) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
}

const hello = (agent: string) => ({
  type: 'hello',
  feed_version: 1,
  world: 'w',
  target_agent_id: agent,
  view_radius: 2,
});

const LABELS = new Map([
  ['ag_a', 'Ember'],
  ['ag_b', 'Moss'],
  ['ag_c', 'Tide'],
]);

/** A monitor with fake sockets, a stand-in renderer, a fake clock and the real gate. */
function monitor(opts: { burst?: number } = {}) {
  let t = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let next = 1;
  const clock = {
    now: () => t,
    setTimer(fn: () => void, ms: number) {
      const id = next++;
      timers.push({ at: t + ms, fn, id });
      return id;
    },
    clearTimer(h: unknown) {
      timers = timers.filter((x) => x.id !== h);
    },
  };
  const advance = (ms: number): void => {
    const end = t + ms;
    for (;;) {
      const due = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((x) => x !== due);
      t = due.at;
      due.fn();
    }
    t = end;
  };
  const gate = new gateMod.SubscribeGate(clock, opts.burst ?? 8, 2000);
  const socks: FakeSocket[] = [];
  const renderer = { calls: [] as string[] };
  const stand = {
    setPixelRatio: () => undefined,
    setSize: () => undefined,
    render: () => renderer.calls.push('render'),
    dispose: () => renderer.calls.push('dispose'),
    forceContextLoss: () => renderer.calls.push('forceContextLoss'),
  } as unknown as Renderer;
  const changed: string[] = [];
  const frame = monitorMod.buildMonitor(() => undefined);
  document.body.appendChild(frame.root);
  const view = paneMod.createPaneView(frame, 'ag_a', 'follow', {
    atlas: { uv: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }), material: NO_MATERIAL },
    atlasInfo: { state: 'ready', count: 1 },
    connect: () => {
      const s = new FakeSocket();
      socks.push(s);
      queueMicrotask(() => s.onopen?.());
      return s;
    },
    labels: LABELS,
    labelOf: (id) => LABELS.get(id) ?? id,
    reducedMotion: true,
    gate,
    key: 'm1',
    onStatus: () => undefined,
    onTargetChanged: (x) => changed.push(x),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    renderer: () => stand,
  });
  const name = () => frame.root.querySelector('.name')?.textContent;
  const notice = () => {
    const n = frame.root.querySelector('.notice') as HTMLElement;
    return n.hidden ? null : (n.querySelector('p')?.textContent ?? '');
  };
  const sock = () => socks.at(-1) as FakeSocket;
  const flush = () => new Promise<void>((r) => queueMicrotask(r));
  return { view, frame, gate, socks, sock, renderer, changed, name, notice, advance, flush };
}

describe('pane view: tuning in', () => {
  it('says "Tuning in to" the agent until the server names it', async () => {
    const m = monitor();
    await m.flush();
    expect(m.name()).toBe('Tuning in to Ember');
    expect(m.sock().sent).toEqual([{ type: 'subscribe', target_agent_id: 'ag_a', mode: 'follow' }]);
    m.sock().feed(hello('ag_a'));
    expect(m.name()).toBe('Ember');
  });

  it('a refused first subscribe shows a notice with Try again, which subscribes again', async () => {
    const m = monitor();
    await m.flush();
    m.sock().feed({ type: 'rate_limited' });
    expect(m.notice()).toBe('Could not tune in to Ember: too many changes at once.');
    (m.frame.root.querySelector('.notice button') as HTMLButtonElement).click();
    expect(m.notice()).toBeNull();
    expect(m.sock().sent).toHaveLength(2);
    m.sock().feed(hello('ag_a'));
    expect(m.name()).toBe('Ember');
  });

  it('pane_cap_reached ends the feed with Try again, which opens a new connection', async () => {
    const m = monitor();
    await m.flush();
    m.sock().feed({ type: 'bye', reason: 'pane_cap_reached' });
    expect(m.notice()).toBe('Too many panes are open.');
    (m.frame.root.querySelector('.notice button') as HTMLButtonElement).click();
    await m.flush();
    expect(m.socks).toHaveLength(2);
    expect(m.sock().sent).toEqual([{ type: 'subscribe', target_agent_id: 'ag_a', mode: 'follow' }]);
  });

  it('the kill switch ends the feed with no Try again', async () => {
    const m = monitor();
    await m.flush();
    m.sock().feed({ type: 'bye', reason: 'kill_switch' });
    expect(m.notice()).toBe('Kino has been switched off by the owner.');
    expect(m.frame.root.querySelector('.notice button')).toBeNull();
  });

  it('says so when an agent never answers, and clears it when the picture comes', async () => {
    const m = monitor();
    await m.flush();
    m.advance(paneMod.TUNE_TIMEOUT_MS);
    expect(m.notice()).toContain('No picture from Ember yet');
    m.sock().feed(hello('ag_a'));
    expect(m.notice()).toBeNull();
  });
});

describe('pane view: retunes', () => {
  it('a refused retune keeps the agent the server is really sending, label included', async () => {
    const m = monitor();
    await m.flush();
    m.sock().feed(hello('ag_a'));
    m.view.setTarget('ag_b');
    m.view.setTarget('ag_c');
    expect(m.name()).toBe('Tuning in to Tide');
    m.sock().feed(hello('ag_b'));
    m.sock().feed({ type: 'rate_limited' });
    expect(m.view.target).toBe('ag_b');
    expect(m.name()).toBe('Moss');
    expect(m.changed).toEqual(['ag_b']);
  });

  it('surfing sends one subscribe, for the last step, after it settles', async () => {
    const m = monitor();
    await m.flush();
    m.sock().feed(hello('ag_a'));
    m.view.setTarget('ag_b', 400);
    m.advance(200);
    m.view.setTarget('ag_c', 400);
    expect(m.name()).toBe('Tuning in to Tide');
    m.advance(399);
    expect(m.sock().sent).toHaveLength(1);
    m.advance(1);
    expect(m.sock().sent.at(-1)).toEqual({
      type: 'subscribe',
      target_agent_id: 'ag_c',
      mode: 'follow',
    });
    expect(m.sock().sent).toHaveLength(2);
  });

  it('holds a retune at the gate once the burst is spent, then sends it', async () => {
    const m = monitor({ burst: 1 });
    await m.flush();
    m.sock().feed(hello('ag_a'));
    m.view.setTarget('ag_b');
    expect(m.sock().sent).toHaveLength(1);
    m.advance(2000);
    expect(m.sock().sent.at(-1)?.target_agent_id).toBe('ag_b');
  });
});

describe('pane view: graphics', () => {
  it('a lost context stops drawing and says so; a restored one clears it', async () => {
    const m = monitor();
    await m.flush();
    m.sock().feed(hello('ag_a'));
    Object.defineProperty(m.frame.canvas, 'clientWidth', { value: 320 });
    Object.defineProperty(m.frame.canvas, 'clientHeight', { value: 180 });
    m.view.frame(16);
    expect(m.renderer.calls).toEqual(['render']);
    m.frame.canvas.dispatchEvent(new win.Event('webglcontextlost') as unknown as Event);
    expect(m.notice()).toContain('The picture was lost');
    m.view.frame(32);
    expect(m.renderer.calls).toEqual(['render']);
    m.frame.canvas.dispatchEvent(new win.Event('webglcontextrestored') as unknown as Event);
    expect(m.notice()).toBeNull();
    m.view.frame(48);
    expect(m.renderer.calls).toEqual(['render', 'render']);
  });

  it('closing gives the WebGL context back, closes the feed and drops its waiting subscribe', async () => {
    const m = monitor({ burst: 1 });
    await m.flush();
    m.sock().feed(hello('ag_a'));
    m.view.setTarget('ag_b');
    expect(m.gate.waiting('m1')).toBe(true);
    m.view.dispose();
    expect(m.renderer.calls).toEqual(['dispose', 'forceContextLoss']);
    expect(m.sock().closed).toBe(true);
    expect(m.gate.waiting('m1')).toBe(false);
    expect(m.frame.root.isConnected).toBe(false);
  });
});
