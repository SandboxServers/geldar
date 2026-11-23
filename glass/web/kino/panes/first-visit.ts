// What an anonymous first visit opens (decision 0166 A10 replaced): up to four distinct public cameras
// picked at random. The relay's subscribe bucket holds a burst of GATE_BURST (8) and refills one token
// per 2 s (decision 0166, glass/src/kino/relay.ts SUBSCRIBE_BURST), and four opens fit inside that
// burst, so they all go at once. Only a plan longer than the burst waits, one refill per extra monitor.
// A bounded automatic retry covers a refused first subscribe (rate_limited, pane_cap_reached).
// Pure: the random source is injected, so the picks are testable.

import type { CameraMode } from '../camera/modes.ts';
import { type SavedWall, type StartMonitor, startupPlan } from './saved.ts';
import { GATE_BURST } from './subscribe-gate.ts';

/** Monitors a first visit opens (the wall's cap). Within GATE_BURST, so the opening never waits. */
export const FIRST_VISIT_MAX = 4;
/** Extra wait on top of one relay refill, used only for monitors past the burst. */
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
 * The first visit's monitors. The first `burst` open at once (delay 0), since the relay's bucket allows
 * that many subscribes in a row; each one after that waits one refill (`spacingMs`) plus the margin.
 * Fewer ids than FIRST_VISIT_MAX opens that many. With the defaults every plan opens at once.
 */
export function firstVisitPlan(
  ids: readonly string[],
  rng: Rng,
  spacingMs: number,
  burst: number = GATE_BURST,
): StartMonitor[] {
  const mode: CameraMode = 'follow';
  return pickRandom(ids, FIRST_VISIT_MAX, rng).map((target, i) => ({
    target,
    mode,
    delayMs: i < burst ? 0 : (i - burst + 1) * (spacingMs + FIRST_VISIT_MARGIN_MS),
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
