import { WEAPONS } from '../../actions/attack.ts';
import { DEFAULT_DIAG_SINK, type DiagSink } from '../../actions/stall-diag.ts';
import type { BodyView, HostileView } from '../view.ts';
import type { ThreatPolicy } from './threat-policy.ts';
import { flyerOf } from './threats.ts';

/** A phantom this close (blocks) makes the operator line speak. Not a trigger radius (decision 0335). */
export const PHANTOM_DIAG_RADIUS = 24;
/** At most one phantom_diag line per Body in this many wall ms (5 s). */
export const PHANTOM_DIAG_INTERVAL_MS = 5_000;
/** Other hostiles (not phantoms) counted within this many blocks. */
const OTHER_RADIUS = 16;
/** The cells above the Body's head read for a roof. */
const ROOF_BLOCKS = 3;

/**
 * Why the phantom trigger did not fire, or `fired`. `cooldown` and `not_visible` are part of the
 * vocabulary but are never written: the runner skips `check` during cooldown, and the view lists
 * only hostiles in sight.
 */
export type PhantomWhy =
  | 'health_too_low'
  | 'no_weapon'
  | 'not_in_range'
  | 'not_visible'
  | 'cooldown'
  | 'fired'
  | 'other';

/** The last phantom_diag line time per Body view (one view per Body, so per life). */
const lastLineAt = new WeakMap<BodyView, number>();

/** The first weapon the Body carries, in the attack action's order, or null. */
function carriedWeapon(view: BodyView): string | null {
  return WEAPONS.find((name) => view.inventoryCount(name) > 0) ?? null;
}

/** The reason the phantom trigger did not fire, read from the Body as it stands. */
function whyNot(
  view: BodyView,
  policy: ThreatPolicy,
  flyer: HostileView | undefined,
  fired: boolean,
): PhantomWhy {
  if (fired) return 'fired';
  if (!flyer) return 'not_in_range';
  if (view.health <= policy.floor()) return 'health_too_low';
  if (!carriedWeapon(view)) return 'no_weapon';
  return 'other';
}

/**
 * Writes the operator's `phantom_diag` line for one evaluation of the phantom trigger in fight_or_flee.
 * Silent when no phantom is listed within PHANTOM_DIAG_RADIUS; at most one line per 5 s per Body.
 * It goes to the Body's own log only: no agent text, no decision changes (decision 0335).
 */
export function phantomDiag(
  view: BodyView,
  policy: ThreatPolicy,
  fired: boolean,
  sink: DiagSink = DEFAULT_DIAG_SINK,
): void {
  const now = sink.now();
  const last = lastLineAt.get(view);
  if (last !== undefined && now - last < PHANTOM_DIAG_INTERVAL_MS) return;
  const phantoms = view
    .nearbyHostiles(PHANTOM_DIAG_RADIUS)
    .filter((hostile) => hostile.name === 'phantom');
  if (phantoms.length === 0) return;
  lastLineAt.set(view, now);
  const weapon = carriedWeapon(view);
  const roof = view.roofWithin?.(ROOF_BLOCKS);
  const others = view.nearbyHostiles(OTHER_RADIUS).filter((h) => h.name !== 'phantom').length;
  const nearest = Math.min(...phantoms.map((hostile) => hostile.distance));
  sink.log(
    JSON.stringify({
      event: 'phantom_diag',
      tick: view.tick,
      armed: weapon !== null && view.health > policy.floor(),
      health: view.health,
      armed_cutoff: policy.floor(),
      reason: whyNot(view, policy, flyerOf(view), fired),
      weapon: weapon ?? 'none',
      phantoms_24: phantoms.length,
      nearest_phantom: Math.round(nearest * 10) / 10,
      others_16: others,
      in_open: roof === undefined ? null : !roof,
    }),
  );
}
