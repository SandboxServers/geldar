// One monitor's live parts (decision 0166): its feed session, scene, renderer and camera rig. The page
// calls frame() from one shared animation loop, only for monitors on screen. Every subscribe waits at
// the page's gate (subscribe-gate.ts). Tested in happy-dom with a stand-in renderer (pane-view.test.ts).

import { type Material, WebGLRenderer } from 'three';
import { chaseFoliageCamera } from '../camera/lakitu.ts';
import type { CameraMode } from '../camera/modes.ts';
import { CameraRig } from '../camera/rig.ts';
import type { FeedState } from '../feed.ts';
import type { UvLookup } from '../mesher.ts';
import { KinoScene } from '../scene.ts';
import { byeText, KinoSession, type Refusal, type SocketLike } from '../session.ts';
import { type StatusInfo, statusLine } from '../status.ts';
import { autoRetryDelay, MAX_AUTO_RETRIES } from './first-visit.ts';
import type { MonitorFrame } from './monitor.ts';
import type { Bucket } from './subscribe-gate.ts';

/** How long a monitor waits for the server to name a new agent before it says so. */
export const TUNE_TIMEOUT_MS = 10_000;
/** Feed ends a viewer can fix by trying again (the others need the owner, a sign-in or a reload). */
const RETRYABLE = new Set([
  'pane_cap_reached',
  'disconnected',
  'feed_unavailable',
  'feed_overloaded',
]);

export interface PaneDeps {
  atlas: { uv: UvLookup; material: Material };
  atlasInfo: StatusInfo['atlas'];
  connect: () => SocketLike;
  labels: ReadonlyMap<string, string>;
  labelOf(id: string): string;
  reducedMotion: boolean;
  /** The page's subscribe gate, keyed by this monitor. */
  gate: {
    request(key: string, bucket: Bucket, send: () => void, delayMs?: number): void;
    cancel(key: string): void;
  };
  key: string;
  /** Wait this long before the first subscribe (a restored wall opens one monitor per refill). */
  startDelayMs?: number;
  /** Called whenever this pane's counts or connection change (the top bar sums them). */
  onStatus(info: { connected: boolean; chunks: number; entities: number }): void;
  /** The agent this monitor is on changed without the page asking (a refusal kept the old one). */
  onTargetChanged?(target: string): void;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
  /** A stand-in renderer for tests. */
  renderer?: (canvas: HTMLCanvasElement) => WebGLRenderer;
}

export interface PaneView {
  readonly rig: CameraRig;
  /** The agent this monitor is on, or tuning in to. */
  readonly target: string;
  readonly mode: CameraMode;
  /** Tunes to an agent; with `settleMs`, only once no other step came for that long (channel surfing). */
  setTarget(agentId: string, settleMs?: number): void;
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
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer =
    deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout> | undefined));
  const renderer = deps.renderer?.(canvas) ?? new WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
  const rig = new CameraRig();
  rig.reducedMotion = deps.reducedMotion;
  rig.setMode(mode);
  let view: KinoScene | null = null;
  let state: FeedState | null = null;
  let connected = false;
  let entityCount = 0;
  /** What the page wants on this monitor; the session follows once the gate lets the subscribe out. */
  const want = { target, mode };
  let last = performance.now();
  let tuning = true;
  let lost = false;
  let disposed = false;
  let noAnswer: unknown = null;
  /** The "no picture yet" notice is up (the picture arriving clears it). */
  let noAnswerShown = false;
  const notice: MonitorFrame['setNotice'] = (text, action) => {
    noAnswerShown = false;
    frame.setNotice(text, action);
  };
  const setTuning = (on: boolean): void => {
    tuning = on;
    frame.setTuning(on);
  };

  /** The current scene's skin note ("skin not loaded: ..."), shown after the status line. */
  let skinNote: string | null = null;
  const onSkinNote = (note: string | null): void => {
    skinNote = note;
    showStatus();
  };
  function showStatus(): void {
    const mine = { connected, chunks: state?.world.keys().length ?? 0, entities: entityCount };
    const line = statusLine({ ...mine, atlas: deps.atlasInfo });
    frame.setStatus(skinNote ? `${line} | ${skinNote}` : line);
    frame.setLive(connected);
    deps.onStatus(mine);
  }

  /** True while the picture is not yet the agent the page wants. */
  const unsettled = (): boolean => {
    const c = session.current;
    return c.shown !== want.target || !c.confirmed;
  };
  let labelShown = '';
  const showLabel = (): void => {
    const tuningIn = unsettled();
    const key = `${tuningIn}:${want.target}`;
    if (key === labelShown) return;
    labelShown = key;
    frame.setLabel(deps.labelOf(want.target), tuningIn);
  };

  const stopWaiting = (): void => {
    if (noAnswer !== null) clearTimer(noAnswer);
    noAnswer = null;
  };
  const armWaiting = (): void => {
    stopWaiting();
    noAnswer = setTimer(() => {
      noAnswer = null;
      if (!unsettled()) return;
      notice(
        `No picture from ${deps.labelOf(want.target)} yet. The agent may be offline; this monitor keeps waiting.`,
      );
      noAnswerShown = true;
    }, TUNE_TIMEOUT_MS);
  };

  const makeSession = (): KinoSession =>
    new KinoSession(deps.connect, {
      onReset(s, agent) {
        state = s;
        view?.dispose();
        view = new KinoScene(s, deps.atlas.uv, deps.atlas.material, deps.labels);
        view.onSkinNote = onSkinNote;
        rig.retarget();
        setTuning(true);
        frame.flicker();
        retriesMade = 0;
        // The server's agent is the one shown; when nothing else is wanted, it is this monitor's agent.
        if (!waitingAtGate) {
          const c = session.current;
          if (c.wanted === agent && want.target !== agent) {
            want.target = agent;
            deps.onTargetChanged?.(agent);
          }
        }
        if (agent === want.target) {
          stopWaiting();
          notice(null);
        }
        showLabel();
        showStatus();
      },
      onChange(change) {
        view?.update(change);
        connected = true;
        if (change.entities) entityCount = change.entities.length;
        if (!unsettled()) {
          stopWaiting();
          if (noAnswerShown) {
            noAnswerShown = false;
            notice(null);
          }
          showLabel();
        }
        showStatus();
      },
      onRefused(r: Refusal) {
        if (r.kind === 'retune') {
          if (!waitingAtGate) {
            want.target = r.kept;
            deps.onTargetChanged?.(r.kept);
          }
          stopWaiting();
          frame.say(`Too many changes at once: still on ${deps.labelOf(r.kept)}.`);
          showLabel();
        } else if (r.kind === 'open') {
          stopWaiting();
          const text = `Could not tune in to ${deps.labelOf(r.agent)}: too many changes at once.`;
          if (!autoRetry(text)) notice(text, { label: 'Try again', run: retry });
        } else frame.say('Too many changes at once: the camera mode was not recorded.');
      },
      onEnd(reason) {
        connected = false;
        stopWaiting();
        if (reason === 'pane_cap_reached' && autoRetry(byeText(reason))) {
          showStatus();
          return;
        }
        notice(
          byeText(reason),
          RETRYABLE.has(reason) ? { label: 'Try again', run: retry } : undefined,
        );
        showStatus();
      },
    });
  /** True while this monitor's subscribe waits at the gate. */
  let waitingAtGate = false;
  let session = makeSession();

  /** Sends the wanted agent and mode once the gate allows; a newer ask replaces a waiting one. */
  const request = (delayMs = 0): void => {
    const c = session.current;
    const bucket: Bucket = session.isEnded || c.wanted !== want.target ? 'target' : 'mode';
    waitingAtGate = true;
    deps.gate.request(
      deps.key,
      bucket,
      () => {
        waitingAtGate = false;
        if (disposed) return;
        // A retune on a monitor whose connection ended opens a new connection.
        if (session.isEnded) session = makeSession();
        session.subscribe(want.target, want.mode);
        if (unsettled()) armWaiting();
        showLabel();
      },
      delayMs,
    );
  };
  /** Retries a refused first subscribe after a wait, showing "Retrying"; false once the retries are used up. */
  let retriesMade = 0;
  let retryTimer: unknown = null;
  const autoRetry = (why: string): boolean => {
    const delay = autoRetryDelay(retriesMade);
    if (delay === null) return false;
    retriesMade += 1;
    notice(`${why} Retrying in ${delay / 1000} s (try ${retriesMade} of ${MAX_AUTO_RETRIES}).`);
    retryTimer = setTimer(() => {
      retryTimer = null;
      notice(null);
      setTuning(true);
      request();
    }, delay);
    return true;
  };
  const retry = (): void => {
    notice(null);
    setTuning(true);
    request();
  };

  setTuning(true);
  frame.setMode(mode);
  showLabel();
  showStatus();
  request(deps.startDelayMs ?? 0);

  const onLost = (): void => {
    lost = true;
    notice(
      'The picture was lost (the browser reset its graphics). It comes back when the browser restores it.',
    );
  };
  const onRestored = (): void => {
    lost = false;
    notice(null);
    // three re-uploads what it draws; a fresh scene makes sure every mesh is built again.
    if (state) {
      view?.dispose();
      view = new KinoScene(state, deps.atlas.uv, deps.atlas.material, deps.labels);
      view.onSkinNote = onSkinNote;
    }
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  return {
    rig,
    get target() {
      return want.target;
    },
    get mode() {
      return want.mode;
    },
    setTarget(t, settleMs = 0) {
      const c = session.current;
      if (t === want.target && !session.isEnded && (c.wanted === t || waitingAtGate)) return;
      want.target = t;
      notice(null);
      frame.flicker();
      if (unsettled()) setTuning(true);
      showLabel();
      request(settleMs);
    },
    setMode(m) {
      if (m === want.mode && !session.isEnded) return;
      want.mode = m;
      rig.setMode(m);
      frame.setMode(m);
      request();
    },
    frame(now) {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (lost || !view || !state) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      const focus = state.focus;
      const noPicture = focus === null || unsettled();
      if (tuning !== noPicture) setTuning(noPicture);
      const raw = rig.update(state.world, focus, dt, state.heading);
      // Chase: pull in and up when foliage sits between the camera and the agent's head.
      const pos =
        focus && rig.mode === 'follow'
          ? chaseFoliageCamera(state.world, { x: focus.x, y: focus.y + 1.6, z: focus.z }, raw)
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
      if (retryTimer !== null) clearTimer(retryTimer);
      retryTimer = null;
      disposed = true;
      stopWaiting();
      deps.gate.cancel(deps.key);
      session.close();
      view?.dispose();
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      // Four monitors are four WebGL contexts: give each back at once rather than when the page is collected.
      renderer.dispose();
      renderer.forceContextLoss();
      frame.root.remove();
    },
  };
}
