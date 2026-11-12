/**
 * The play view of a snapshot: what the `look` tool returns (spec 5.15.3, the design table).
 * World text (heard lines and sign text) leaves the snapshot and goes to `untrusted_world_text`,
 * so the snapshot part carries no text written by other agents or players. The snapshot part
 * also drops the identifiers and counters an agent has no use for: snapshot_id, shard,
 * body_generation and the raw world ticks (the day and time of day stay).
 */
import type { LookResult, Snapshot, UntrustedWorldText } from '@geldar/contract';

/** Heard lines kept in the play view, newest first (the design table). */
export const PLAY_SPEECH_LIMIT = 40;

/** Sign texts kept in the play view (the `signs` maxItems of the contract). */
export const PLAY_SIGN_LIMIT = 20;

/** Entity records kept in the play view, nearest first (the Body's snapshot keeps more). */
export const PLAY_ENTITY_LIMIT = 12;

type PlaySnapshot = LookResult['snapshot'];
type Signs = NonNullable<UntrustedWorldText['signs']>;

/** Values the Threshold fills in from Postgres; the snapshot from the Body does not know them. */
export interface PlayViewOptions {
  /** Thoughts left today, from `mcp_budget`. */
  budget: number;
  /** Days since the last sleep, from the Postgres record of the life. */
  daysSinceSleep: number;
}

export interface PlayView {
  snapshot: PlaySnapshot;
  untrusted: UntrustedWorldText;
}

/**
 * Splits a Body snapshot into the play view. The snapshot part is built field by field, so a
 * field added to the Body's snapshot does not reach agents until it is named here. It has no
 * `heard` lines, no `events_since_last_thought` (the player event log is the source) and no text
 * on notable blocks. `budget` and `daysSinceSleep` replace the Body's values.
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

  const playSnapshot: PlaySnapshot = {
    agent_id: snapshot.agent_id,
    revision: snapshot.revision,
    world_time: {
      day: snapshot.world_time.day,
      time_of_day: snapshot.world_time.time_of_day,
      weather: snapshot.world_time.weather,
    },
    // Both objects are built field by field: a key the Body adds later does not reach the agent.
    self: {
      position: snapshot.self.position,
      health: snapshot.self.health,
      hunger: snapshot.self.hunger,
      armor: snapshot.self.armor,
      held_item: snapshot.self.held_item,
      inventory: snapshot.self.inventory,
      effects: snapshot.self.effects,
      budget_remaining_thoughts: options.budget,
      days_since_sleep: options.daysSinceSleep,
      ...(snapshot.self.unlocked_recipes === undefined
        ? {}
        : { unlocked_recipes: snapshot.self.unlocked_recipes }),
    },
    surroundings: {
      blocks_summary: snapshot.surroundings.blocks_summary,
      ...(snapshot.surroundings.standing_on === undefined
        ? {}
        : { standing_on: snapshot.surroundings.standing_on }),
      ...(snapshot.surroundings.block_above_feet === undefined
        ? {}
        : { block_above_feet: snapshot.surroundings.block_above_feet }),
      ...(snapshot.surroundings.enclosed === undefined
        ? {}
        : { enclosed: snapshot.surroundings.enclosed }),
      notable_blocks: notableBlocks,
      entities: snapshot.surroundings.entities?.slice(0, PLAY_ENTITY_LIMIT),
      agents: snapshot.surroundings.agents,
    },
    heard: [],
    events_since_last_thought: [],
    ...(snapshot.current_plan === undefined ? {} : { current_plan: snapshot.current_plan }),
    ...(snapshot.stuck === undefined ? {} : { stuck: snapshot.stuck }),
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
