// Names the building packets share, reserved in BLD-S3a so no later packet renames them.

/** The one neutral refusal for break and plan while body_actions.building is off. */
export const BUILDING_REFUSAL = 'building is not available';
/** The event a plan emits (plan_progress). */
export const PLAN_EVENT = 'plan_progress';
/** The KV bucket for plan chunks (key `<life_id>.<plan_id>.<seq>`). */
export const PLAN_BUCKET = 'geldar-plans';
/** The KV bucket for the seen map (key `<life_id>.<sx>.<sy>.<sz>`). */
export const SEEN_BUCKET = 'geldar-seen';
/**
 * The wake reason a plan raises when its materials run out. The contract's wake-event schema has no
 * `plan_stopped`; `precondition_failed` is the allowed reason for a step whose precondition (the
 * materials) is missing (review fix 1).
 */
export const PLAN_WAKE_REASON = 'precondition_failed';
