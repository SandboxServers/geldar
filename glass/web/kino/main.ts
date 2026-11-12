// Production browser entry: the real Kino WebSocket, the K06 panes, the K05 camera and the K04 renderer.
// Not unit tested (needs WebGL and a canvas); the parts it calls are (session.ts, targets.ts, pane-set.ts).

import { WebGLRenderer } from 'three';
import { buildAtlas } from './atlas.ts';
import { bindControls } from './camera/controls.ts';
import type { CameraMode } from './camera/modes.ts';
import { CameraRig } from './camera/rig.ts';
import type { FeedState } from './feed.ts';
import { foliageSafeCamera } from './foliage.ts';
import { PaneSet } from './panes/pane-set.ts';
import { KinoScene } from './scene.ts';
import { byeText, KinoSession, type SocketLike } from './session.ts';
import { aggregateStatus, type StatusInfo, statusLine } from './status.ts';
import {
  type TargetsOutcome,
  targetsFetchFailed,
  targetsNotice,
  targetsOutcome,
} from './targets.ts';

const meta = (name: string): string =>
  document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? '';
const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

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

async function main(): Promise<void> {
  const notice = el('notice');
  const barStatus = el('status');
  // The status line is always shown, even when the camera list cannot be loaded.
  barStatus.textContent = statusLine({
    connected: false,
    chunks: 0,
    entities: 0,
    atlas: { state: 'loading' },
  });
  notice.replaceChildren();
  const outcome = await loadTargets();
  if (!outcome.ok) {
    showLoadFailure(notice, outcome.message, outcome.retryAfterSeconds);
    return;
  }
  const targets = outcome.targets;
  notice.textContent = targetsNotice(targets) ?? '';
  if (!targets.signedIn && targets.enabled) {
    const a = el<HTMLAnchorElement>('signin');
    a.href = meta('kino-signin-url') || '/';
    a.hidden = false;
  }
  const picker = el<HTMLSelectElement>('picker');
  for (const id of targets.agents) picker.add(new Option(id, id));
  const openBtn = el<HTMLButtonElement>('open');
  if (!targets.enabled || targets.agents.length === 0) {
    openBtn.disabled = true;
    picker.disabled = true;
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
    barStatus.textContent = statusLine({
      connected: false,
      chunks: 0,
      entities: 0,
      atlas: atlasInfo,
    });
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
  const host = el('panes');
  const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/kino/ws`;

  // One source of truth: the top bar is the aggregate of the pane lines.
  const paneInfos = new Map<number, { connected: boolean; chunks: number; entities: number }>();
  const showBar = (): void => {
    barStatus.textContent = statusLine(aggregateStatus([...paneInfos.values()], atlasInfo));
  };
  const panes = new PaneSet((id, target, mode) => {
    const root = document.createElement('div');
    root.className = 'pane';
    const canvas = document.createElement('canvas');
    const msg = document.createElement('div');
    msg.className = 'msg';
    const tools = document.createElement('div');
    tools.className = 'tools';
    const status = document.createElement('div');
    status.className = 'status';
    root.append(canvas, tools, msg, status);
    let connected = false;
    let entityCount = 0;
    const showStatus = (): void => {
      const mine = { connected, chunks: state?.world.keys().length ?? 0, entities: entityCount };
      paneInfos.set(id, mine);
      status.textContent = statusLine({ ...mine, atlas: atlasInfo });
      showBar();
    };
    host.appendChild(root);
    const renderer = new WebGLRenderer({ canvas, antialias: false });
    const rig = new CameraRig();
    rig.setMode(mode);
    bindControls(canvas, rig);
    let view: KinoScene | null = null;
    let state: FeedState | null = null;
    let live = true;
    const session = new KinoSession(() => browserSocket(wsUrl), {
      onReset(s) {
        state = s;
        view = new KinoScene(s, atlas.uv, atlas.material);
        connected = true;
        showStatus();
      },
      onChange(change) {
        view?.update(change);
        connected = true;
        if (change.entities) entityCount = change.entities.length;
        showStatus();
        if (change.notice) {
          msg.textContent = change.notice;
          setTimeout(() => {
            if (msg.textContent === change.notice) msg.textContent = '';
          }, 4000);
        }
      },
      onEnd(reason) {
        msg.textContent = byeText(reason);
        connected = false;
        showStatus();
      },
    });
    let current: CameraMode = mode;
    const setMode = (m: CameraMode): void => {
      current = m;
      rig.setMode(m);
      session.subscribe(currentTarget, m);
    };
    let currentTarget = target;
    for (const m of ['follow', 'orbit', 'free'] as const) {
      const b = document.createElement('button');
      b.textContent = m;
      b.addEventListener('click', () => setMode(m));
      tools.appendChild(b);
    }
    const close = document.createElement('button');
    close.textContent = 'Close';
    close.addEventListener('click', () => {
      panes.close(id);
    });
    tools.appendChild(close);
    session.subscribe(target, current);
    let last = performance.now();
    const frame = (): void => {
      if (!live) return;
      if (view && state) {
        const now = performance.now();
        const focus = state.focus;
        const raw = rig.update(state.world, focus, Math.min(0.1, (now - last) / 1000));
        last = now;
        // Follow: pull in and up when foliage sits between the camera and the agent's head.
        const pos =
          focus && rig.mode === 'follow'
            ? foliageSafeCamera(state.world, { x: focus.x, y: focus.y + 1.6, z: focus.z }, raw)
            : raw;
        view.camera.position.set(pos.x, pos.y, pos.z);
        view.cullAround(pos);
        const look = rig.lookTarget(focus);
        view.camera.lookAt(look.x, look.y, look.z);
        view.updateLabels(look);
        renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
        view.camera.aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
        view.camera.updateProjectionMatrix();
        renderer.render(view.scene, view.camera);
      }
      requestAnimationFrame(frame);
    };
    frame();
    return {
      setTarget(t) {
        currentTarget = t;
        session.subscribe(t, current);
      },
      setMode,
      dispose() {
        live = false;
        paneInfos.delete(id);
        showBar();
        session.close();
        renderer.dispose();
        root.remove();
      },
    };
  });
  openBtn.addEventListener('click', () => {
    if (panes.open(picker.value) === null) notice.textContent = 'Too many panes are open.';
  });
}

void main();
