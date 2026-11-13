// The wall a viewer left, kept in their own browser (localStorage) and restored on the next visit
// (decision 0166). Pure apart from the injected storage. Only agents the server lists now are
// restored, so a saved wall never widens what a viewer may watch; the server checks every subscribe.

import type { CameraMode } from '../camera/modes.ts';
import type { Layout } from '../keys.ts';

export const SAVED_KEY = 'kino-wall-v1';

export interface SavedWall {
  layout: Layout;
  monitors: { target: string; mode: CameraMode }[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const LAYOUTS: readonly string[] = ['wall', 'feature', 'solo'];
const MODES: readonly string[] = ['follow', 'orbit', 'free'];

/** The saved wall, keeping only monitors whose agent is in `allowed`, at most `cap`. Anything unreadable is null. */
export function readSaved(
  storage: StorageLike | null,
  allowed: readonly string[],
  cap: number,
): SavedWall | null {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(SAVED_KEY) ?? null;
  } catch {
    return null;
  }
  if (raw === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const o = v as { layout?: unknown; monitors?: unknown };
  const layout = typeof o.layout === 'string' && LAYOUTS.includes(o.layout) ? o.layout : 'wall';
  const monitors = (Array.isArray(o.monitors) ? o.monitors : [])
    .flatMap((m: unknown) => {
      if (typeof m !== 'object' || m === null) return [];
      const { target, mode } = m as { target?: unknown; mode?: unknown };
      if (typeof target !== 'string' || !allowed.includes(target)) return [];
      return [
        {
          target,
          mode: (typeof mode === 'string' && MODES.includes(mode) ? mode : 'follow') as CameraMode,
        },
      ];
    })
    .slice(0, cap);
  return { layout: layout as Layout, monitors };
}

/** Saves the wall; a full or blocked storage is ignored (the wall still works, it is just not remembered). */
export function writeSaved(storage: StorageLike | null, wall: SavedWall): void {
  try {
    storage?.setItem(SAVED_KEY, JSON.stringify(wall));
  } catch {
    // Private windows and blocked site data: nothing to do.
  }
}

/** The browser's localStorage, or null where reading it throws. */
export function browserStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export interface StartMonitor {
  target: string;
  mode: CameraMode;
  /** Wait before its first subscribe, so a reload does not spend the relay's whole burst. */
  delayMs: number;
}

/**
 * What a page load opens. A saved wall comes back one monitor per `spacingMs` (the relay's refill), the
 * first at once. Only a first visit (nothing saved) tunes CH 1 to the first agent (assumption A10); a
 * wall the viewer emptied stays empty.
 */
export function startupPlan(
  saved: SavedWall | null,
  ids: readonly string[],
  spacingMs: number,
): StartMonitor[] {
  if (saved === null)
    return ids.length > 0 ? [{ target: ids[0] as string, mode: 'follow', delayMs: 0 }] : [];
  return saved.monitors.map((m, i) => ({ ...m, delayMs: i * spacingMs }));
}
