// Input binding for one monitor's canvas (decision 0161). The keyboard is not bound here: the page
// routes keys to the active monitor only (keys.ts), so one key press never drives every camera.
//   Mouse:  drag = turn (follow and orbit swing round the agent; free looks), wheel = zoom,
//           double-click = recentre.
//   Touch:  one-finger drag = turn, two-finger pinch = zoom (follow and orbit) or fly (free),
//           double-tap = recentre.
// keyMove and pinchDelta are pure and tested; bindPointer needs a DOM.

import type { CameraRig, MoveInput } from './rig.ts';

/** Maps the set of held keys to a move vector (free-fly). */
export function keyMove(held: ReadonlySet<string>): MoveInput {
  const axis = (pos: string, neg: string): number =>
    (held.has(pos) ? 1 : 0) - (held.has(neg) ? 1 : 0);
  return {
    right: axis('d', 'a'),
    forward: axis('w', 's'),
    up: axis(' ', 'shift'),
  };
}

/** The keys keyMove reads. */
export const MOVE_KEYS: ReadonlySet<string> = new Set(['w', 'a', 's', 'd', ' ', 'shift']);

/** Pinch: spreading fingers (distance grows) zooms in, so the radius shrinks. */
export function pinchDelta(prevDist: number, nextDist: number, scale = 0.1): number {
  return (prevDist - nextDist) * scale;
}

/** Wheel: one notch of accumulated delta is one step (follow zoom levels need whole steps). */
export const WHEEL_NOTCH = 100;

export interface PointerHooks {
  /** Any press on the canvas: the page makes this monitor active. */
  onActivate(): void;
}

export function bindPointer(
  el: HTMLElement,
  getRig: () => CameraRig,
  hooks: PointerHooks,
): () => void {
  const touches = new Map<number, { x: number; y: number }>();
  let wheel = 0;
  let lastTap = 0;
  const onDown = (e: PointerEvent): void => {
    hooks.onActivate();
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    el.setPointerCapture?.(e.pointerId);
    if (e.pointerType === 'touch') {
      const now = performance.now();
      if (now - lastTap < 300 && touches.size === 1) getRig().recentre();
      lastTap = now;
    }
  };
  const onUp = (e: PointerEvent): void => {
    touches.delete(e.pointerId);
  };
  const onMove = (e: PointerEvent): void => {
    const prev = touches.get(e.pointerId);
    if (!prev) return;
    const rig = getRig();
    const others = [...touches.entries()].filter(([id]) => id !== e.pointerId);
    const next = { x: e.clientX, y: e.clientY };
    if (others.length === 0) {
      rig.look(-(next.x - prev.x) * 0.01, (next.y - prev.y) * 0.01);
    } else {
      const [, other] = others[0] as [number, { x: number; y: number }];
      const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
      const d1 = Math.hypot(next.x - other.x, next.y - other.y);
      if (rig.mode === 'free') rig.fly(-pinchDelta(d0, d1));
      else if (rig.mode === 'follow') {
        wheel += (d0 - d1) * 2;
        if (Math.abs(wheel) >= WHEEL_NOTCH) {
          rig.zoomStep(Math.sign(wheel));
          wheel = 0;
        }
      } else rig.zoom(pinchDelta(d0, d1));
    }
    touches.set(e.pointerId, next);
  };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    hooks.onActivate();
    const rig = getRig();
    if (rig.mode === 'orbit') {
      rig.zoom(e.deltaY * 0.02);
      return;
    }
    wheel += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    if (Math.abs(wheel) >= WHEEL_NOTCH) {
      rig.zoomStep(Math.sign(wheel));
      wheel = 0;
    }
  };
  const onDouble = (): void => getRig().recentre();

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('dblclick', onDouble);
  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    el.removeEventListener('wheel', onWheel);
    el.removeEventListener('dblclick', onDouble);
  };
}
