// Production browser entry (decision 0166): the monitor wall. It loads the camera list and the
// textures, then keeps up to DEFAULT_PANES monitors, one active, in a layout, with the channel guide,
// the keyboard map and the remembered wall. Not unit tested (it is the page's wiring); the decisions it
// makes live in tested modules: keys (routeKey), keyboard, wall-layout, saved (startupPlan),
// subscribe-gate, pane-set, pane-view, monitor, session, guide, targets and the camera rig.

import { buildAtlas } from './atlas.ts';
import { bindPointer, keyMove } from './camera/controls.ts';
import type { CameraMode } from './camera/modes.ts';
import { ChannelGuide } from './guide.ts';
import { bindKeyboard } from './keyboard.ts';
import { type Layout, nextLayout, nextMode, surf } from './keys.ts';
import { openingPlan } from './panes/first-visit.ts';
import {
  buildEmptySlot,
  buildMonitor,
  type MonitorAction,
  type MonitorFrame,
  orderTiles,
  showControls,
} from './panes/monitor.ts';
import { DEFAULT_PANES, PaneSet } from './panes/pane-set.ts';
import { createPaneView, type PaneView } from './panes/pane-view.ts';
import { browserStorage, readSaved, writeSaved } from './panes/saved.ts';
import { GATE_REFILL_MS, SubscribeGate } from './panes/subscribe-gate.ts';
import { freeChannel, planWall } from './panes/wall-layout.ts';
import type { SocketLike } from './session.ts';
import { loadTargets, showLoadFailure } from './startup.ts';
import { aggregateStatus, type StatusInfo, statusLine } from './status.ts';
import { labelFor, type TargetAgent, targetsNotice } from './targets.ts';

const meta = (name: string): string =>
  document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? '';
const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
/**
 * Surfing waits this long after the last step before it retunes, so a run of steps sends one subscribe.
 * The rate limit itself is kept by the subscribe gate (8 at once, then one per 2 s, like the relay).
 */
const SURF_SETTLE_MS = 400;

/** A WebSocket as the session sees it. */
function browserSocket(url: string): SocketLike {
  const w = new WebSocket(url);
  return {
    send: (t) => w.send(t),
    close: () => w.close(),
    set onopen(f: (() => void) | null) {
      w.onopen = f;
    },
    set onmessage(f: ((ev: { data: unknown }) => void) | null) {
      w.onmessage = f;
    },
    set onclose(f: (() => void) | null) {
      w.onclose = f;
    },
  } as SocketLike;
}

/** One polite announcement for screen readers, said once when it becomes true. */
function announce(text: string): void {
  el('say').textContent = text;
}

interface Monitor {
  id: number;
  channel: number;
  frame: MonitorFrame;
  view: PaneView;
}

/** The top bar's Details button folds the status line; bound once, since a Retry runs main() again. */
function bindStatusToggle(): void {
  el('toggle-status').addEventListener('click', (e) => {
    const bar = el('status');
    bar.hidden = !bar.hidden;
    (e.currentTarget as HTMLElement).setAttribute('aria-expanded', String(!bar.hidden));
  });
}

/** Unfolds the status line, for a failure the viewer must see. */
function showStatusLine(): void {
  el('status').hidden = false;
  el('toggle-status').setAttribute('aria-expanded', 'true');
}

async function main(): Promise<void> {
  const notice = el('notice');
  const barStatus = el('status');
  barStatus.textContent = statusLine({
    connected: false,
    chunks: 0,
    entities: 0,
    atlas: { state: 'loading' },
  });
  notice.replaceChildren();
  const outcome = await loadTargets();
  if (!outcome.ok)
    return showLoadFailure(notice, outcome.message, outcome.retryAfterSeconds, () => void main());
  const targets = outcome.targets;
  notice.textContent = targetsNotice(targets) ?? '';
  if (!targets.signedIn && targets.enabled) {
    const a = el<HTMLAnchorElement>('signin');
    a.href = meta('kino-signin-url') || '/';
    a.hidden = false;
  }
  const agents: readonly TargetAgent[] = targets.agents;
  const ids = agents.map((a) => a.id);
  const labels = new Map(agents.map((a) => [a.id, a.label]));
  const labelOf = (id: string): string => labelFor(id, agents);
  const wallEl = el('wall');
  if (!targets.enabled || agents.length === 0) {
    wallEl.replaceChildren(buildEmptySlot(() => undefined));
    (wallEl.querySelector('.nosignal button') as HTMLButtonElement).disabled = true;
    return;
  }
  const texturesUrl =
    new URLSearchParams(location.search).get('textures') || meta('kino-textures-url');
  if (!texturesUrl) {
    notice.textContent = 'No map textures are configured for Kino.';
    return;
  }
  let atlas: Awaited<ReturnType<typeof buildAtlas>>;
  let atlasInfo: StatusInfo['atlas'];
  try {
    atlas = await buildAtlas(texturesUrl);
    atlasInfo = { state: 'ready', count: atlas.count };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    barStatus.textContent = statusLine({
      connected: false,
      chunks: 0,
      entities: 0,
      atlas: { state: 'failed', error },
    });
    showStatusLine();
    return;
  }
  const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/kino/ws`;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const narrowQuery = matchMedia('(width < 700px)');
  const storage = browserStorage();
  const gate = new SubscribeGate({
    now: () => performance.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  });

  const monitors = new Map<number, Monitor>();
  const paneInfos = new Map<number, { connected: boolean; chunks: number; entities: number }>();
  let active: number | null = null;
  let layout: Layout = 'wall';
  const showBar = (): void => {
    barStatus.textContent = statusLine(aggregateStatus([...paneInfos.values()], atlasInfo));
  };
  const order = (): Monitor[] => [...monitors.values()].sort((a, b) => a.channel - b.channel);
  const save = (): void =>
    writeSaved(storage, {
      layout,
      monitors: order().map((m) => ({ target: m.view.target, mode: m.view.mode })),
    });

  const slots = new Map<number, HTMLElement>();
  const setActive = (id: number | null): void => {
    if (active !== null && active !== id) {
      const prev = monitors.get(active);
      if (prev) prev.view.rig.move = { right: 0, up: 0, forward: 0 };
    }
    active = id;
    for (const m of monitors.values()) m.frame.setActive(m.id === id);
    layoutWall();
  };

  const layoutButtons = document.querySelectorAll<HTMLButtonElement>('[data-layout]');
  function layoutWall(): void {
    const byChannel = new Map(order().map((m) => [m.channel, m]));
    const plan = planWall({
      ids: [...byChannel.keys()],
      active: active === null ? null : (monitors.get(active)?.channel ?? null),
      layout,
      cap: DEFAULT_PANES,
      narrow: narrowQuery.matches,
    });
    wallEl.style.gridTemplateColumns = plan.columns;
    wallEl.style.gridTemplateRows = plan.rows;
    wallEl.dataset.layout = layout;
    const keep = new Map<number, HTMLElement>();
    const vacancies = Array.from({ length: DEFAULT_PANES }, (_, i) => i + 1).filter(
      (channel) => !byChannel.has(channel),
    );
    const fullGrid = plan.cells.length === DEFAULT_PANES && (layout === 'wall' || active === null);
    for (const cell of plan.cells) {
      const channel = cell.id ?? (vacancies.shift() as number);
      const monitor = byChannel.get(channel);
      let node = monitor?.frame.root ?? slots.get(channel);
      if (!node) {
        node = buildEmptySlot(openGuide, channel);
        slots.set(channel, node);
      }
      // Wall slots keep their channel number after a neighbour is cleared.
      node.style.gridArea = fullGrid ? (plan.cells[channel - 1]?.area ?? cell.area) : cell.area;
      node.hidden = false;
      monitor?.frame.setFeatured(cell.featured);
      keep.set(channel, node);
    }
    for (const channel of plan.hidden) {
      const m = byChannel.get(channel) as Monitor;
      m.frame.root.hidden = true;
      keep.set(channel, m.frame.root);
    }
    // Tab order follows the channel numbers; monitors already on the wall are not moved.
    orderTiles(
      wallEl,
      [...keep].sort((a, b) => a[0] - b[0]).map(([, node]) => node),
    );
    for (const b of layoutButtons)
      b.setAttribute('aria-pressed', String(b.dataset.layout === layout));
    drawSelection();
  }

  const setLayout = (l: Layout): void => {
    layout = l;
    layoutWall();
    save();
    announce(`Layout: ${l}`);
  };

  const retune = (m: Monitor, target: string, settle: boolean): void => {
    m.view.setTarget(target, settle ? SURF_SETTLE_MS : 0);
    save();
    drawSelection();
    announce(`CH ${m.channel}: ${labelOf(target)}`);
  };

  const action = (m: Monitor, a: MonitorAction): void => {
    setActive(m.id);
    const rig = m.view.rig;
    switch (a.kind) {
      case 'mode':
        m.view.setMode(a.mode);
        drawZoom(m);
        save();
        break;
      case 'rotate':
        rig.rotateStep(a.steps);
        break;
      case 'zoom':
        rig.zoomStep(a.steps);
        drawZoom(m);
        break;
      case 'zoom-level':
        if (rig.mode === 'follow') rig.zoomStep(a.level - rig.chase.zoom);
        drawZoom(m);
        break;
      case 'recentre':
        rig.recentre();
        break;
      case 'surf': {
        const next = surf(ids, m.view.target, a.steps);
        if (next) retune(m, next, true);
        break;
      }
      case 'guide':
        openGuide();
        break;
      case 'solo':
        setLayout(layout === 'solo' ? 'wall' : 'solo');
        break;
      case 'info':
        m.frame.toggleInfo();
        break;
      case 'close':
        panes.close(m.id);
        break;
    }
  };

  /** The first-subscribe delay for the monitor being opened (a restored wall spaces them out). */
  let openDelay = 0;
  let openChannel: number | undefined;
  const panes = new PaneSet((id, target, mode) => {
    const used = new Set([...monitors.values()].map((x) => x.channel));
    const channel = freeChannel(used, openChannel);
    let self: Monitor | null = null;
    const frame = buildMonitor((a) => self && action(self, a));
    frame.setChannel(channel);
    const view = createPaneView(frame, target, mode, {
      atlas,
      atlasInfo,
      connect: () => browserSocket(wsUrl),
      labels,
      labelOf,
      reducedMotion,
      gate,
      key: String(id),
      startDelayMs: openDelay,
      onStatus(info) {
        paneInfos.set(id, info);
        showBar();
      },
      // The server kept the old agent (a refused retune): remember the wall as it really is.
      onTargetChanged: () => {
        save();
        drawSelection();
      },
    });
    bindPointer(frame.canvas, () => view.rig, { onActivate: () => active !== id && setActive(id) });
    self = { id, channel, frame, view };
    drawZoom(self);
    monitors.set(id, self);
    return {
      setTarget: (t) => view.setTarget(t),
      setMode: (m) => view.setMode(m),
      dispose() {
        monitors.delete(id);
        paneInfos.delete(id);
        view.dispose();
        showBar();
        if (active === id) setActive(order()[0]?.id ?? null);
        else layoutWall();
        save();
      },
    };
  });

  const openMonitor = (
    target: string,
    mode: CameraMode = 'follow',
    delayMs = 0,
    channel?: number,
  ): void => {
    openDelay = delayMs;
    openChannel = channel;
    const id = panes.open(target, mode);
    openDelay = 0;
    openChannel = undefined;
    if (id === null) {
      notice.textContent = `All ${DEFAULT_PANES} monitors are in use: close one first.`;
      return;
    }
    notice.textContent = targetsNotice(targets) ?? '';
    setActive(id);
    save();
    announce(`CH ${(monitors.get(id) as Monitor).channel}: ${labelOf(target)}`);
  };

  const guideTrigger = el<HTMLButtonElement>('open-guide');
  const guide = new ChannelGuide(
    el<HTMLDialogElement>('guide'),
    el('guide-inline'),
    guideTrigger,
    narrowQuery,
    agents,
    {
      tune(agentId) {
        const m = active !== null ? monitors.get(active) : undefined;
        if (m) retune(m, agentId, false);
        else openMonitor(agentId);
      },
      watchNew: (agentId, channel) => openMonitor(agentId, 'follow', 0, channel),
    },
  );
  const focusTitle = el('focus-title');
  const cameraControls = el('camera-controls');
  const clear = el<HTMLButtonElement>('clear-monitor');
  const drawZoom = ({ frame, view: { rig } }: Monitor): void =>
    frame.setZoom(rig.mode === 'follow' ? rig.chase.zoom : null);

  function drawSelection(): void {
    const onAir = new Map<string, number[]>();
    for (const m of order())
      onAir.set(m.view.target, [...(onAir.get(m.view.target) ?? []), m.channel]);
    const a = active !== null ? monitors.get(active) : undefined;
    guide.update({
      onAir,
      activeChannel: a?.channel ?? null,
      canOpen: monitors.size < DEFAULT_PANES,
    });
    focusTitle.textContent = a
      ? `CH ${a.channel} · ${labelOf(a.view.target)}`
      : 'No channel selected';
    clear.disabled = a === undefined;
    showControls(cameraControls, a?.frame.controls ?? null, focusTitle);
  }

  /** Opens the phone sheet or focuses the choices in the wide pane. */
  function openGuide(channel?: number, opener?: HTMLElement): void {
    guide.open(channel, opener ?? guideTrigger);
  }

  clear.addEventListener('click', () => {
    const m = active !== null ? monitors.get(active) : undefined;
    if (m) action(m, { kind: 'close' });
    if (clear.disabled) focusTitle.focus();
  });

  const help = el<HTMLDialogElement>('help');
  help.querySelector('.help-close')?.addEventListener('click', () => help.close());
  guideTrigger.addEventListener('click', () => openGuide());
  el('open-help').addEventListener('click', () => help.showModal());
  for (const b of layoutButtons)
    b.addEventListener('click', () => setLayout(b.dataset.layout as Layout));
  narrowQuery.addEventListener('change', layoutWall);

  // The keyboard drives the active monitor only.
  const activeMonitor = (): Monitor | undefined =>
    active !== null ? monitors.get(active) : undefined;
  bindKeyboard(window, {
    modal: () => help.open || guide.isOpen,
    freeFly: () => activeMonitor()?.view.rig.mode === 'free',
    move(held) {
      const rig = activeMonitor()?.view.rig;
      if (rig) rig.move = rig.mode === 'free' ? keyMove(held) : { right: 0, up: 0, forward: 0 };
    },
    run(cmd) {
      const m = activeMonitor();
      switch (cmd.kind) {
        case 'select': {
          const pick = order().find((x) => x.channel === cmd.index + 1);
          if (pick) setActive(pick.id);
          return;
        }
        case 'cycle-mode':
          if (m) action(m, { kind: 'mode', mode: nextMode(m.view.mode) });
          return;
        case 'cycle-layout':
          return setLayout(nextLayout(layout));
        case 'guide':
          return openGuide();
        case 'help':
          return help.showModal();
        case 'escape':
          return;
        case 'mode':
        case 'rotate':
        case 'zoom':
        case 'recentre':
        case 'surf':
        case 'solo':
        case 'info':
        case 'close':
          if (m) action(m, cmd);
          else if (cmd.kind !== 'close') openGuide();
          return;
      }
    },
  });

  // The wall the viewer left (one monitor per refill), or the first agent on CH 1 for a first visit.
  const saved = readSaved(storage, ids, DEFAULT_PANES);
  layout = saved?.layout ?? 'wall';
  // A first visit with no sign-in opens up to four random public cameras, staggered; a saved wall or a
  // signed-in first visit keep the existing plan.
  for (const s of openingPlan(saved, targets.signedIn, ids, Math.random, GATE_REFILL_MS))
    openMonitor(s.target, s.mode, s.delayMs);
  if (active === null) layoutWall();

  const loop = (now: number): void => {
    for (const m of monitors.values()) {
      if (m.frame.root.hidden) continue;
      drawZoom(m);
      m.view.frame(now);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

bindStatusToggle();
void main();
