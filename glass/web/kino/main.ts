// Production browser entry (decision 0161): the monitor wall. It loads the camera list and the
// textures, then keeps up to DEFAULT_PANES monitors, one active, in a layout, with the channel guide,
// the keyboard map and the remembered wall. Not unit tested (needs WebGL and a canvas); the parts it
// calls are (keys, wall-layout, saved, pane-set, session, targets, rig).

import { buildAtlas } from './atlas.ts';
import { bindPointer, keyMove, MOVE_KEYS } from './camera/controls.ts';
import type { CameraMode } from './camera/modes.ts';
import { ChannelGuide } from './guide.ts';
import { keyCommand, type Layout, nextLayout, nextMode, suppressesDefault, surf } from './keys.ts';
import {
  buildEmptySlot,
  buildMonitor,
  type MonitorAction,
  type MonitorFrame,
} from './panes/monitor.ts';
import { DEFAULT_PANES, PaneSet } from './panes/pane-set.ts';
import { createPaneView, type PaneView } from './panes/pane-view.ts';
import { browserStorage, readSaved, writeSaved } from './panes/saved.ts';
import { planWall } from './panes/wall-layout.ts';
import type { SocketLike } from './session.ts';
import { aggregateStatus, type StatusInfo, statusLine } from './status.ts';
import {
  labelFor,
  type TargetAgent,
  type TargetsOutcome,
  targetsFetchFailed,
  targetsNotice,
  targetsOutcome,
} from './targets.ts';

const meta = (name: string): string =>
  document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? '';
const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
/** Surfing waits this long after the last step before it retunes (the server allows 8 subscribes, then one per 2 s). */
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

async function loadTargets(): Promise<TargetsOutcome> {
  try {
    const r = await fetch('/kino/targets', { credentials: 'same-origin' });
    const body: unknown = await r.json().catch(() => null);
    return targetsOutcome(r.status, r.headers.get('Retry-After'), body);
  } catch {
    return targetsFetchFailed();
  }
}

/** One polite announcement for screen readers, said once when it becomes true. */
function announce(text: string): void {
  el('say').textContent = text;
}

/** A visible failure message with a Retry button; the button waits out Retry-After. */
function showLoadFailure(notice: HTMLElement, message: string, wait: number | null): void {
  const text = document.createElement('span');
  text.textContent = message;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Retry';
  let left = wait ?? 0;
  const tick = (): void => {
    retry.disabled = left > 0;
    retry.textContent = left > 0 ? `Retry (${left}s)` : 'Retry';
    if (left > 0) {
      left -= 1;
      setTimeout(tick, 1000);
    }
  };
  tick();
  retry.addEventListener('click', () => void main());
  notice.replaceChildren(text, ' ', retry);
}

interface Monitor {
  id: number;
  channel: number;
  frame: MonitorFrame;
  view: PaneView;
  /** A retune waiting for surfing to settle. */
  pending: { target: string; timer: ReturnType<typeof setTimeout> } | null;
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
  if (!outcome.ok) return showLoadFailure(notice, outcome.message, outcome.retryAfterSeconds);
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
    return;
  }
  const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/kino/ws`;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const narrowQuery = matchMedia('(max-width: 720px)');
  const storage = browserStorage();

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
      monitors: order().map((m) => ({
        target: m.pending?.target ?? m.view.target,
        mode: m.view.mode,
      })),
    });

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
    const plan = planWall({
      ids: order().map((m) => m.id),
      active,
      layout,
      cap: DEFAULT_PANES,
      narrow: narrowQuery.matches,
    });
    wallEl.style.gridTemplateColumns = plan.columns;
    wallEl.style.gridTemplateRows = plan.rows;
    wallEl.dataset.layout = layout;
    const keep: HTMLElement[] = [];
    for (const cell of plan.cells) {
      const node =
        cell.id === null
          ? buildEmptySlot(() => openGuide())
          : (monitors.get(cell.id) as Monitor).frame.root;
      node.style.gridArea = cell.area;
      node.hidden = false;
      if (cell.id !== null) (monitors.get(cell.id) as Monitor).frame.setFeatured(cell.featured);
      keep.push(node);
    }
    for (const id of plan.hidden) {
      const m = monitors.get(id) as Monitor;
      m.frame.root.hidden = true;
      keep.push(m.frame.root);
    }
    // Monitors stay in the DOM in channel order (their canvases keep their WebGL contexts); empty slots are rebuilt.
    for (const child of [...wallEl.children])
      if (!keep.includes(child as HTMLElement)) child.remove();
    for (const node of keep) if (node.parentElement !== wallEl) wallEl.appendChild(node);
    for (const b of layoutButtons)
      b.setAttribute('aria-pressed', String(b.dataset.layout === layout));
  }

  const setLayout = (l: Layout): void => {
    layout = l;
    layoutWall();
    save();
    announce(`Layout: ${l}`);
  };

  const retune = (m: Monitor, target: string, settle: boolean): void => {
    m.frame.setLabel(labelOf(target));
    m.frame.flicker();
    if (m.pending) clearTimeout(m.pending.timer);
    const go = (): void => {
      m.pending = null;
      m.view.setTarget(target);
      save();
    };
    if (!settle) {
      go();
      return;
    }
    m.pending = { target, timer: setTimeout(go, SURF_SETTLE_MS) };
    announce(`CH ${m.channel}: ${labelOf(target)}`);
  };

  const action = (m: Monitor, a: MonitorAction): void => {
    setActive(m.id);
    const rig = m.view.rig;
    switch (a.kind) {
      case 'mode':
        m.view.setMode(a.mode);
        save();
        break;
      case 'rotate':
        rig.rotateStep(a.steps);
        break;
      case 'zoom':
        rig.zoomStep(a.steps);
        break;
      case 'recentre':
        rig.recentre();
        break;
      case 'surf': {
        const next = surf(ids, m.pending?.target ?? m.view.target, a.steps);
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

  const panes = new PaneSet((id, target, mode) => {
    const used = new Set([...monitors.values()].map((x) => x.channel));
    let channel = 1;
    while (used.has(channel)) channel++;
    let self: Monitor | null = null;
    const frame = buildMonitor((a) => self && action(self, a));
    frame.setChannel(channel);
    frame.setLabel(labelOf(target));
    const view = createPaneView(frame, target, mode, {
      atlas,
      atlasInfo,
      connect: () => browserSocket(wsUrl),
      labels,
      reducedMotion,
      onStatus(info) {
        paneInfos.set(id, info);
        showBar();
      },
    });
    bindPointer(frame.canvas, () => view.rig, { onActivate: () => active !== id && setActive(id) });
    self = { id, channel, frame, view, pending: null };
    monitors.set(id, self);
    return {
      setTarget: (t) => view.setTarget(t),
      setMode: (m) => view.setMode(m),
      dispose() {
        const m = monitors.get(id);
        if (m?.pending) clearTimeout(m.pending.timer);
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

  const openMonitor = (target: string, mode: CameraMode = 'follow'): void => {
    const id = panes.open(target, mode);
    if (id === null) {
      notice.textContent = `All ${DEFAULT_PANES} monitors are in use: close one first.`;
      return;
    }
    notice.textContent = targetsNotice(targets) ?? '';
    setActive(id);
    save();
    announce(`CH ${(monitors.get(id) as Monitor).channel}: ${labelOf(target)}`);
  };

  const guide = new ChannelGuide(el<HTMLDialogElement>('guide'), agents, {
    tune(agentId) {
      const m = active !== null ? monitors.get(active) : undefined;
      if (m) retune(m, agentId, false);
      else openMonitor(agentId);
    },
    watchNew: (agentId) => openMonitor(agentId),
  });
  function openGuide(): void {
    const onAir = new Map<string, number[]>();
    for (const m of order()) {
      const t = m.pending?.target ?? m.view.target;
      onAir.set(t, [...(onAir.get(t) ?? []), m.channel]);
    }
    const a = active !== null ? monitors.get(active) : undefined;
    guide.open(
      { onAir, activeChannel: a?.channel ?? null, canOpen: monitors.size < DEFAULT_PANES },
      labelOf,
    );
  }

  const help = el<HTMLDialogElement>('help');
  help.querySelector('.help-close')?.addEventListener('click', () => help.close());
  el('open-guide').addEventListener('click', openGuide);
  el('open-help').addEventListener('click', () => help.showModal());
  el('toggle-status').addEventListener('click', (e) => {
    barStatus.hidden = !barStatus.hidden;
    (e.currentTarget as HTMLElement).setAttribute('aria-expanded', String(!barStatus.hidden));
  });
  for (const b of layoutButtons)
    b.addEventListener('click', () => setLayout(b.dataset.layout as Layout));
  narrowQuery.addEventListener('change', layoutWall);

  // The keyboard drives the active monitor only.
  const held = new Set<string>();
  const syncMove = (): void => {
    const m = active !== null ? monitors.get(active) : undefined;
    if (m)
      m.view.rig.move =
        m.view.rig.mode === 'free' ? keyMove(held) : { right: 0, up: 0, forward: 0 };
  };
  addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (help.open || guide.isOpen || t?.closest('input, select, textarea')) return;
    const m = active !== null ? monitors.get(active) : undefined;
    const k = e.key.toLowerCase();
    if (MOVE_KEYS.has(k) && m?.view.rig.mode === 'free') {
      held.add(k);
      syncMove();
      if (suppressesDefault(e.key)) e.preventDefault();
      return;
    }
    const cmd = keyCommand(e.key, { ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey });
    if (!cmd) return;
    if (suppressesDefault(e.key)) e.preventDefault();
    // Buttons keep their own Enter.
    if (cmd.kind === 'solo' && t?.closest('button, a')) return;
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
  });
  addEventListener('keyup', (e) => {
    held.delete(e.key.toLowerCase());
    syncMove();
  });
  addEventListener('blur', () => {
    held.clear();
    syncMove();
  });

  // The wall the viewer left, or the first agent on CH 1 for a first visit.
  const saved = readSaved(storage, ids, DEFAULT_PANES);
  layout = saved?.layout ?? 'wall';
  if (saved && saved.monitors.length > 0)
    for (const s of saved.monitors) openMonitor(s.target, s.mode);
  else openMonitor(ids[0] as string);
  if (active === null) layoutWall();

  const loop = (now: number): void => {
    for (const m of monitors.values()) if (!m.frame.root.hidden) m.view.frame(now);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

void main();
