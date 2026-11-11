// Input binding. Keyboard and mouse on desktop, touch on a phone.
//   Desktop: drag = look/orbit, wheel = zoom, W A S D = move, Space/Shift = up/down (free),
//            1 = follow, 2 = orbit, 3 = free.
//   Touch:   one-finger drag = look/orbit, two-finger pinch = zoom (orbit) or fly
//            forward/back (free), on-screen mode buttons call rig.setMode.
// keyMove and pinchDelta are pure and tested; bindControls needs a DOM and is not.

import type { CameraMode } from './modes.ts';
import type { CameraRig, MoveInput } from './rig.ts';

const KEY_MODES: Record<string, CameraMode> = { '1': 'follow', '2': 'orbit', '3': 'free' };

/** Maps the set of held keys to a move vector. */
export function keyMove(held: ReadonlySet<string>): MoveInput {
  const axis = (pos: string, neg: string): number =>
    (held.has(pos) ? 1 : 0) - (held.has(neg) ? 1 : 0);
  return {
    right: axis('d', 'a'),
    forward: axis('w', 's'),
    up: axis(' ', 'shift'),
  };
}

/** Pinch: spreading fingers (distance grows) zooms in, so the radius shrinks. */
export function pinchDelta(prevDist: number, nextDist: number, scale = 0.1): number {
  return (prevDist - nextDist) * scale;
}

export function bindControls(el: HTMLElement, rig: CameraRig): () => void {
  const held = new Set<string>();
  const touches = new Map<number, { x: number; y: number }>();
  const sync = (): void => {
    rig.move = rig.mode === 'free' ? keyMove(held) : { right: 0, up: 0, forward: 0 };
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    const mode = KEY_MODES[k];
    if (mode) rig.setMode(mode);
    held.add(k);
    sync();
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    held.delete(e.key.toLowerCase());
    sync();
  };
  const onDown = (e: PointerEvent): void => {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    el.setPointerCapture?.(e.pointerId);
  };
  const onUp = (e: PointerEvent): void => {
    touches.delete(e.pointerId);
  };
  const onMove = (e: PointerEvent): void => {
    const prev = touches.get(e.pointerId);
    if (!prev) return;
    const others = [...touches.entries()].filter(([id]) => id !== e.pointerId);
    const next = { x: e.clientX, y: e.clientY };
    if (others.length === 0) {
      rig.look(-(next.x - prev.x) * 0.01, (next.y - prev.y) * 0.01);
    } else {
      const [, other] = others[0] as [number, { x: number; y: number }];
      const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
      const d1 = Math.hypot(next.x - other.x, next.y - other.y);
      if (rig.mode === 'free') rig.fly(-pinchDelta(d0, d1));
      else rig.zoom(pinchDelta(d0, d1));
    }
    touches.set(e.pointerId, next);
  };
  const onWheel = (e: WheelEvent): void => rig.zoom(e.deltaY * 0.02);

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('wheel', onWheel);
  addEventListener('pointerup', onUp);
  addEventListener('pointercancel', onUp);
  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', onKeyUp);
  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('wheel', onWheel);
    removeEventListener('pointerup', onUp);
    removeEventListener('pointercancel', onUp);
    removeEventListener('keydown', onKeyDown);
    removeEventListener('keyup', onKeyUp);
  };
}
