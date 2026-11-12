import type { SnapshotProjector } from './types.ts';

/** The agent's own state. Built field by field: a key the Body adds later does not reach the agent. */
export const selfProjector: SnapshotProjector = (snapshot, options) => ({
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
    ...(snapshot.self.status_flags === undefined
      ? {}
      : { status_flags: snapshot.self.status_flags }),
    ...(snapshot.self.air === undefined ? {} : { air: snapshot.self.air }),
    ...(snapshot.self.ground_below === undefined
      ? {}
      : { ground_below: snapshot.self.ground_below }),
    ...(snapshot.self.trapped === undefined ? {} : { trapped: snapshot.self.trapped }),
    ...(snapshot.self.sun === undefined ? {} : { sun: snapshot.self.sun }),
  },
});
