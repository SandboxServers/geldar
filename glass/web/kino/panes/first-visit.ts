// What an anonymous first visit opens (decision 0166 A10 replaced): up to four distinct public cameras
// picked at random, opened one per relay refill plus a margin so the viewer's subscribe bucket is never
// exhausted. A bounded automatic retry covers a refused first subscribe (rate_limited, pane_cap_reached).
// Pure: the random source is injected, so the picks are testable.

import type { CameraMode } from '../camera/modes.ts';
import { type SavedWall, type StartMonitor, startupPlan } from './saved.ts';

/** Monitors a first visit opens (the wall's cap). */
export const FIRST_VISIT_MAX = 4;
/** Extra wait on top of one relay refill, so a stagger never lands on an empty bucket. */
export const FIRST_VISIT_MARGIN_MS = 500;
/** Automatic retries of a refused first subscribe before the monitor offers "Try again". */
export const MAX_AUTO_RETRIES = 3;
const RETRY_BASE_MS = 4000;

/** A random source in [0, 1), as Math.random. */
export type Rng = () => number;

/** Up to `count` distinct ids, picked uniformly without replacement (the input is not changed). */
export function pickRandom(ids: readonly string[], count: number, rng: Rng): string[] {
  const pool = [...ids];
  const out: string[] = [];
  while (out.length < count && pool.length > 0) {
    const i = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
    out.push(...pool.splice(i, 1));
  }
  return out;
}

/**
 * The first visit's monitors: the first at once, then one every `spacingMs` (the relay refill) plus the
 * margin. Fewer ids than FIRST_VISIT_MAX opens that many.
 */
export function firstVisitPlan(
  ids: readonly string[],
  rng: Rng,
  spacingMs: number,
): StartMonitor[] {
  const mode: CameraMode = 'follow';
  return pickRandom(ids, FIRST_VISIT_MAX, rng).map((target, i) => ({
    target,
    mode,
    delayMs: i * (spacingMs + FIRST_VISIT_MARGIN_MS),
  }));
}

/**
 * The wait before automatic retry number `retriesMade + 1`, or null once MAX_AUTO_RETRIES are used up
 * (the monitor then shows its "Try again" button instead).
 */
export function autoRetryDelay(retriesMade: number): number | null {
  if (retriesMade >= MAX_AUTO_RETRIES) return null;
  return RETRY_BASE_MS * 2 ** retriesMade;
}

/**
 * What a page load opens. A first visit with no sign-in (no saved wall) gets the random four; a saved
 * wall always wins (no random pick), and a signed-in first visit keeps startupPlan's CH 1 tune.
 */
export function openingPlan(
  saved: SavedWall | null,
  signedIn: boolean,
  ids: readonly string[],
  rng: Rng,
  spacingMs: number,
): StartMonitor[] {
  if (saved === null && !signedIn) return firstVisitPlan(ids, rng, spacingMs);
  return startupPlan(saved, ids, spacingMs);
}
