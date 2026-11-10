/**
 * The play view of a snapshot: what the `look` tool returns (spec 5.15.3, the design table).
 * World text (heard lines and sign text) leaves the snapshot and goes to `untrusted_world_text`,
 * so the snapshot part carries no text written by other agents or players.
 */
import type { Snapshot, UntrustedWorldText } from '@geldar/contract';

/** Heard lines kept in the play view, newest first (the design table). */
export const PLAY_SPEECH_LIMIT = 40;

/** Sign texts kept in the play view (the `signs` maxItems of the contract). */
export const PLAY_SIGN_LIMIT = 20;

type Signs = NonNullable<UntrustedWorldText['signs']>;

/** Values the Threshold fills in from Postgres; the snapshot from the Body does not know them. */
export interface PlayViewOptions {
  /** Thoughts left today, from `mcp_budget`. */
  budget: number;
  /** Days since the last sleep, from the Postgres record of the life. */
  daysSinceSleep: number;
}

/**
 * `snapshot` is a Snapshot with no heard lines and no text on notable blocks; it validates as the
 * `snapshot` of `LookResult` (PlaySnapshot), which the generated types describe only loosely.
 */
export interface PlayView {
  snapshot: Snapshot;
  untrusted: UntrustedWorldText;
}

/**
 * Splits a Body snapshot into the play view. The snapshot part has no `heard` lines, no
 * `events_since_last_thought` (the player event log is the source) and no text on notable
 * blocks. `budget` and `daysSinceSleep` replace the Body's values.
 */
export function toPlayView(snapshot: Snapshot, options: PlayViewOptions): PlayView {
  const speech = [...snapshot.heard]
    .sort((a, b) => a.age_seconds - b.age_seconds)
    .slice(0, PLAY_SPEECH_LIMIT)
    .map((line) => ({ from: line.from, text: line.text }));

  const signs: string[] = [];
  const notableBlocks: Snapshot['surroundings']['notable_blocks'] = [];
  for (const { text, ...block } of snapshot.surroundings.notable_blocks) {
    if (text !== undefined) signs.push(text);
    notableBlocks.push(block);
  }

  const playSnapshot: Snapshot = {
    ...snapshot,
    heard: [],
    events_since_last_thought: [],
    self: {
      ...snapshot.self,
      budget_remaining_thoughts: options.budget,
      days_since_sleep: options.daysSinceSleep,
    },
    surroundings: {
      ...snapshot.surroundings,
      notable_blocks: notableBlocks,
    },
  };

  return {
    snapshot: playSnapshot,
    untrusted: {
      speech,
      // The generated type is a tuple for maxItems 20; the length is enforced by the slice.
      signs: signs.slice(0, PLAY_SIGN_LIMIT) as Signs,
    },
  };
}
