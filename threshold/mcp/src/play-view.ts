/**
 * The play view of a snapshot: what the `look` tool returns (spec 5.15.3, the design table).
 * World text (heard lines and sign text) leaves the snapshot and goes to `untrusted_world_text`,
 * so the snapshot part carries no text written by other agents or players. The snapshot part
 * also drops the identifiers and counters an agent has no use for: snapshot_id, shard,
 * body_generation and the raw world ticks (the day and time of day stay).
 *
 * This file composes the sections: each projector in `play-view/` builds one part of the snapshot
 * part, and `SNAPSHOT_PROJECTORS` lists them in the order the keys appear.
 */
import type { Snapshot } from '@geldar/contract';
import { headerProjector } from './play-view/header.ts';
import { logAndPlanProjector } from './play-view/log-and-plan.ts';
import { selfProjector } from './play-view/self.ts';
import { surroundingsProjector } from './play-view/surroundings.ts';
import type {
  PlaySnapshot,
  PlayView,
  PlayViewOptions,
  SnapshotProjector,
} from './play-view/types.ts';
import { untrustedText } from './play-view/untrusted.ts';

export type {
  PlaySnapshot,
  PlayView,
  PlayViewOptions,
  SnapshotProjector,
} from './play-view/types.ts';
export {
  PLAY_ENTITY_LIMIT,
  PLAY_SIGN_LIMIT,
  PLAY_SPEECH_LIMIT,
} from './play-view/types.ts';

/** The snapshot-part projectors, in the order their keys appear in the play view. */
export const SNAPSHOT_PROJECTORS: readonly SnapshotProjector[] = [
  headerProjector,
  selfProjector,
  surroundingsProjector,
  logAndPlanProjector,
];

/**
 * Composes a play view from the given projectors (in list order). Each projector's keys are copied onto
 * the snapshot part; the untrusted part is built the same way every time.
 */
export function composePlayView(
  snapshot: Snapshot,
  options: PlayViewOptions,
  projectors: readonly SnapshotProjector[],
): PlayView {
  const merged: Record<string, unknown> = {};
  for (const project of projectors) Object.assign(merged, project(snapshot, options));
  // The projectors together fill the PlaySnapshot keys; the list is typed, so the assertion is made once here.
  return { snapshot: merged as unknown as PlaySnapshot, untrusted: untrustedText(snapshot) };
}

/**
 * Splits a Body snapshot into the play view. The snapshot part is built field by field, so a
 * field added to the Body's snapshot does not reach agents until it is named in a projector. It has no
 * `heard` lines, no `events_since_last_thought` (the player event log is the source) and no text
 * on notable blocks. `budget` and `daysSinceSleep` replace the Body's values.
 */
export function toPlayView(snapshot: Snapshot, options: PlayViewOptions): PlayView {
  return composePlayView(snapshot, options, SNAPSHOT_PROJECTORS);
}
