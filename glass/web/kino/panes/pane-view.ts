// One monitor's live parts (decision 0161): its feed session, scene, renderer and camera rig. The page
// calls frame() from one shared animation loop, only for monitors on screen. Needs WebGL; the pure
// parts it calls (session, rig, feed) are tested.

import { type Material, WebGLRenderer } from 'three';
import type { CameraMode } from '../camera/modes.ts';
import { CameraRig } from '../camera/rig.ts';
import type { FeedState } from '../feed.ts';
import { foliageSafeCamera } from '../foliage.ts';
import type { UvLookup } from '../mesher.ts';
import { KinoScene } from '../scene.ts';
import { byeText, KinoSession, type SocketLike } from '../session.ts';
import { type StatusInfo, statusLine } from '../status.ts';
import type { MonitorFrame } from './monitor.ts';

export interface PaneDeps {
  atlas: { uv: UvLookup; material: Material };
  atlasInfo: StatusInfo['atlas'];
  connect: () => SocketLike;
  labels: ReadonlyMap<string, string>;
  reducedMotion: boolean;
  /** Called whenever this pane's counts or connection change (the top bar sums them). */
  onStatus(info: { connected: boolean; chunks: number; entities: number }): void;
  /** The server refused a retune: the monitor keeps showing `kept` (the page restores its label). */
  onTargetKept?(kept: string): void;
}

export interface PaneView {
  readonly rig: CameraRig;
  readonly target: string;
  readonly mode: CameraMode;
  setTarget(agentId: string): void;
  setMode(mode: CameraMode): void;
  /** Draws one frame; dt is clamped. */
  frame(now: number): void;
  dispose(): void;
}

export function createPaneView(
  frame: MonitorFrame,
  target: string,
  mode: CameraMode,
  deps: PaneDeps,
): PaneView {
  const { canvas } = frame;
  const renderer = new WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
  const rig = new CameraRig();
  rig.reducedMotion = deps.reducedMotion;
  rig.setMode(mode);
  let view: KinoScene | null = null;
  let state: FeedState | null = null;
  let connected = false;
  let entityCount = 0;
  let current = mode;
  let currentTarget = target;
  let last = performance.now();
  let tuning = true;
  /** A retune waits for the server; the screen shows static until the new agent is placed. */
  let retuning = false;
  const setTuning = (on: boolean): void => {
    tuning = on;
    frame.setTuning(on);
  };

  const showStatus = (): void => {
    const mine = { connected, chunks: state?.world.keys().length ?? 0, entities: entityCount };
    frame.setStatus(statusLine({ ...mine, atlas: deps.atlasInfo }));
    frame.setLive(connected);
    deps.onStatus(mine);
  };

  const makeSession = (): KinoSession =>
    new KinoSession(deps.connect, {
      onReset(s) {
        state = s;
        retuning = false;
        view?.dispose();
        view = new KinoScene(s, deps.atlas.uv, deps.atlas.material, deps.labels);
        rig.retarget();
        setTuning(true);
        frame.flicker();
        showStatus();
      },
      onChange(change) {
        view?.update(change);
        connected = true;
        if (change.entities) entityCount = change.entities.length;
        showStatus();
        if (change.notice) frame.say(change.notice);
      },
      onRetuneRefused(kept) {
        currentTarget = kept;
        retuning = false;
        deps.onTargetKept?.(kept);
      },
      onEnd(reason) {
        frame.say(byeText(reason));
        connected = false;
        retuning = false;
        showStatus();
      },
    });
  let session = makeSession();
  /** Subscribes, first opening a new connection when the last one ended (a retune revives a dead monitor). */
  const subscribe = (t: string, m: CameraMode): void => {
    if (session.isEnded) session = makeSession();
    session.subscribe(t, m);
  };
  session.subscribe(target, mode);
  setTuning(true);
  frame.setMode(mode);
  showStatus();

  return {
    rig,
    get target() {
      return currentTarget;
    },
    get mode() {
      return current;
    },
    setTarget(t) {
      const now = session.current;
      if (!session.isEnded && t === now.target && now.pending === null) return;
      currentTarget = t;
      retuning = !session.isEnded && now.target !== null && t !== now.target;
      if (retuning) setTuning(true);
      subscribe(t, current);
    },
    setMode(m) {
      if (m === current && !session.isEnded) return;
      current = m;
      rig.setMode(m);
      frame.setMode(m);
      subscribe(currentTarget, m);
    },
    frame(now) {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!view || !state) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      const focus = state.focus;
      const want = focus === null || retuning;
      if (tuning !== want) setTuning(want);
      const raw = rig.update(state.world, focus, dt, state.heading);
      // Chase: pull in and up when foliage sits between the camera and the agent's head.
      const pos =
        focus && rig.mode === 'follow'
          ? foliageSafeCamera(state.world, { x: focus.x, y: focus.y + 1.6, z: focus.z }, raw)
          : raw;
      view.camera.position.set(pos.x, pos.y, pos.z);
      view.cullAround(pos);
      view.setFadeFocus(
        pos,
        focus && rig.mode !== 'free' ? { x: focus.x, y: focus.y + 1.2, z: focus.z } : null,
      );
      const look = rig.lookTarget(focus);
      view.camera.lookAt(look.x, look.y, look.z);
      view.updateLabels(look);
      renderer.setSize(w, h, false);
      view.camera.aspect = w / Math.max(1, h);
      view.camera.updateProjectionMatrix();
      renderer.render(view.scene, view.camera);
    },
    dispose() {
      session.close();
      view?.dispose();
      renderer.dispose();
      frame.root.remove();
    },
  };
}
