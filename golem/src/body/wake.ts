/**
 * Why the Body asks the Mind for a thought. The first group is the contract's `wake_on` set
 * (Appendix C, `thought.schema.json` Intent.wake_on); the last four are raised by the Body itself.
 */
export type WakeReason =
  | 'directly_addressed'
  | 'precondition_failed'
  | 'unexpected_damage'
  | 'goal_completed'
  /** `new_agent_within_<blocks>`: another agent came within that many blocks. */
  | `new_agent_within_${number}`
  /** A reflex fired because of danger (retreat, fight or flee, hazard escape). */
  | 'reflex_danger'
  /** The running action failed and the intent cannot absorb it. */
  | 'action_failed'
  /** The intent hit `max_world_ticks` or `max_block_operations`. */
  | 'limit_reached'
  /** A restarted Body found no plan to resume and none arrived in the wait (spec 5.2). */
  | 'no_plan';

/** One wake the Body decided on: the reason, the world tick, and the intent it concerns if any. */
export interface WakeRequest {
  reason: WakeReason;
  /** World age when the wake was decided. */
  tick: number;
  intentId: string | null;
  /** Short plain text for the Mind and the log; never parsed. */
  detail?: string;
}
