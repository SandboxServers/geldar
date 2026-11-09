import type { BodyView, HostileView } from '../view.ts';

/** Mobs that only attack when provoked: the Body neither fights nor blames them for a hurt. */
const NEUTRAL = new Set([
  'enderman',
  'zombified_piglin',
  'piglin',
  'wolf',
  'iron_golem',
  'bee',
  'polar_bear',
  'llama',
  'dolphin',
]);
/** Mobs that are neutral only by day. */
const NEUTRAL_BY_DAY = new Set(['spider']);
/** Mobs that blow up when hit or close: never meleed, always fled from. */
const SUICIDE = new Set(['creeper']);

/** True for a mob the Body should treat as a danger now: not neutral, and not neutral by day. */
export function isHostileNow(hostile: HostileView, view: BodyView): boolean {
  if (NEUTRAL.has(hostile.name)) return false;
  return !(NEUTRAL_BY_DAY.has(hostile.name) && view.isNight === false);
}

/** True for a mob that must not be meleed (it explodes). */
export function isSuicideMob(name: string): boolean {
  return SUICIDE.has(name);
}

/** The hostiles within `radius` that count as a danger now, nearest first. */
export function dangers(view: BodyView, radius: number): HostileView[] {
  return view.nearbyHostiles(radius).filter((hostile) => isHostileNow(hostile, view));
}

/**
 * The nearest danger that is hitting the Body: within melee reach and facing it. A view that does
 * not say (`attacking` missing) is read as attacking, so a hand-built view keeps working.
 */
export function attackerOf(view: BodyView, radius: number): HostileView | undefined {
  return dangers(view, radius).find((hostile) => hostile.attacking !== false);
}
