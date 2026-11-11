// Production browser entry: the real Kino WebSocket, the K06 panes, the K05 camera and the K04 renderer.
// Not unit tested (needs WebGL and a canvas); the parts it calls are (session.ts, targets.ts, pane-set.ts).

import { WebGLRenderer } from 'three';
import { buildAtlas } from './atlas.ts';
import { bindControls } from './camera/controls.ts';
import type { CameraMode } from './camera/modes.ts';
import { CameraRig } from './camera/rig.ts';
import type { FeedState } from './feed.ts';
import { PaneSet } from './panes/pane-set.ts';
import { KinoScene } from './scene.ts';
import { byeText, KinoSession, type SocketLike } from './session.ts';
import { parseTargets, targetsNotice } from './targets.ts';

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

async function main(): Promise<void> {
  const targets = parseTargets(
    await fetch('/kino/targets', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
  );
  const notice = el('notice');
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
  const atlas = await buildAtlas(texturesUrl);
  const host = el('panes');
  const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/kino/ws`;

  const panes = new PaneSet((id, target, mode) => {
    const root = document.createElement('div');
    root.className = 'pane';
    const canvas = document.createElement('canvas');
    const msg = document.createElement('div');
    msg.className = 'msg';
    const tools = document.createElement('div');
    tools.className = 'tools';
    root.append(canvas, tools, msg);
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
      },
      onChange(change) {
        view?.update(change);
      },
      onEnd(reason) {
        msg.textContent = byeText(reason);
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
        const pos = rig.update(state.world, focus, Math.min(0.1, (now - last) / 1000));
        last = now;
        view.camera.position.set(pos.x, pos.y, pos.z);
        const look = rig.lookTarget(focus);
        view.camera.lookAt(look.x, look.y, look.z);
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
