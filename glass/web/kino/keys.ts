// The Kino keyboard map (decision 0166). Pure: a key press becomes a command for the wall or for the
// active monitor. Movement keys held for free-fly (W A S D, Space, Shift) are read by keyMove in
// camera/controls.ts, not here. Every command is view-only; none reaches the world.

import { MOVE_KEYS } from './camera/controls.ts';
import type { CameraMode } from './camera/modes.ts';

export type Layout = 'wall' | 'feature' | 'solo';

export type Command =
  | { kind: 'select'; index: number }
  | { kind: 'cycle-mode' }
  | { kind: 'mode'; mode: CameraMode }
  | { kind: 'rotate'; steps: number }
  | { kind: 'zoom'; steps: number }
  | { kind: 'recentre' }
  | { kind: 'surf'; steps: number }
  | { kind: 'cycle-layout' }
  | { kind: 'solo' }
  | { kind: 'close' }
  | { kind: 'guide' }
  | { kind: 'help' }
  | { kind: 'info' }
  | { kind: 'escape' };

export interface KeyMods {
  ctrl?: boolean;
  meta?: boolean;
  alt?: boolean;
}

const MODES: readonly CameraMode[] = ['follow', 'orbit', 'free'];

/** The next camera mode in the cycle follow, orbit, free. */
export function nextMode(m: CameraMode): CameraMode {
  return MODES[(MODES.indexOf(m) + 1) % MODES.length] as CameraMode;
}

const LAYOUTS: readonly Layout[] = ['wall', 'feature', 'solo'];

export function nextLayout(l: Layout): Layout {
  return LAYOUTS[(LAYOUTS.indexOf(l) + 1) % LAYOUTS.length] as Layout;
}

/**
 * The command for a key (KeyboardEvent.key), or null when the key is not Kino's. Browser shortcuts
 * (with Ctrl, Cmd or Alt) are never taken.
 */
export function keyCommand(key: string, mods: KeyMods = {}): Command | null {
  if (mods.ctrl || mods.meta || mods.alt) return null;
  const k = key.length === 1 ? key.toLowerCase() : key;
  if (k >= '1' && k <= '9' && k.length === 1) return { kind: 'select', index: Number(k) - 1 };
  switch (k) {
    case 'c':
      return { kind: 'cycle-mode' };
    case 'q':
    case 'ArrowLeft':
      return { kind: 'rotate', steps: -1 };
    case 'e':
    case 'ArrowRight':
      return { kind: 'rotate', steps: 1 };
    case 'ArrowUp':
    case '=':
    case '+':
      return { kind: 'zoom', steps: -1 };
    case 'ArrowDown':
    case '-':
    case '_':
      return { kind: 'zoom', steps: 1 };
    case 'r':
      return { kind: 'recentre' };
    case '[':
      return { kind: 'surf', steps: -1 };
    case ']':
      return { kind: 'surf', steps: 1 };
    case 'l':
      return { kind: 'cycle-layout' };
    case 'Enter':
      return { kind: 'solo' };
    case 'x':
    case 'Delete':
      return { kind: 'close' };
    case 't':
      return { kind: 'guide' };
    case '?':
      return { kind: 'help' };
    case 'i':
      return { kind: 'info' };
    case 'Escape':
      return { kind: 'escape' };
    default:
      return null;
  }
}

/** Keys whose browser default (scrolling the page) Kino suppresses while it handles them. */
export function suppressesDefault(key: string): boolean {
  return key === ' ' || key.startsWith('Arrow');
}

/** The agent `steps` away from `current` in the list, wrapping round; the first agent when current is not listed. */
export function surf(ids: readonly string[], current: string | null, steps: number): string | null {
  if (ids.length === 0) return null;
  const i = current === null ? -1 : ids.indexOf(current);
  if (i < 0) return ids[0] as string;
  const n = ids.length;
  return ids[(((i + steps) % n) + n) % n] as string;
}

/** One keydown as the page sees it. */
export interface KeyPress extends KeyMods {
  key: string;
  /** The browser's auto-repeat while the key is held. */
  repeat?: boolean;
  /** Focus is on a button or link (it keeps its own Space and Enter). */
  onButton?: boolean;
  /** The active monitor is in free-fly (W A S D, Space and Shift move it). */
  freeFly?: boolean;
}

/** What the page does with a keydown: hold a free-fly key, run a command, or leave it to the browser. */
export type KeyRoute =
  | { kind: 'move'; key: string; preventDefault: boolean }
  | { kind: 'command'; command: Command; preventDefault: boolean }
  | { kind: 'ignore'; preventDefault: boolean };

/**
 * Routes a keydown. A held key's auto-repeat never repeats a command (holding X would close every
 * monitor), though it still keeps the page from scrolling; a focused button keeps Space and Enter.
 */
export function routeKey(p: KeyPress): KeyRoute {
  const k = p.key.toLowerCase();
  const own = (p.key === ' ' || p.key === 'Enter') && p.onButton === true;
  if (own) return { kind: 'ignore', preventDefault: false };
  if (MOVE_KEYS.has(k) && p.freeFly && !p.ctrl && !p.meta && !p.alt)
    return { kind: 'move', key: k, preventDefault: suppressesDefault(p.key) };
  const command = keyCommand(p.key, p);
  if (!command) return { kind: 'ignore', preventDefault: false };
  const preventDefault = suppressesDefault(p.key);
  if (p.repeat) return { kind: 'ignore', preventDefault };
  return { kind: 'command', command, preventDefault };
}
