// Names the building packets share, reserved in BLD-S3a so no later packet renames them.

/** The one neutral refusal for break and plan while body_actions.building is off. */
export const BUILDING_REFUSAL = 'building is not available';
/** The event a plan emits (plan_progress). */
export const PLAN_EVENT = 'plan_progress';
/** The KV bucket for plan chunks (key `<life_id>.<plan_id>.<seq>`). */
export const PLAN_BUCKET = 'geldar-plans';
/** The KV bucket for the seen map (key `<life_id>.<sx>.<sy>.<sz>`). */
export const SEEN_BUCKET = 'geldar-seen';
/** The wake reason a stopped plan raises. Placeholder: BLD-14 confirms the name. */
export const PLAN_WAKE_REASON = 'plan_stopped';
/** Metric names for operators (BLD-27); all `geldar_` prefixed, labels carry codes only. */
export const PLAN_METRICS = {
  cellsPlaced: 'geldar_plan_cells_placed_total',
  cellsBroken: 'geldar_plan_cells_broken_total',
  planSeconds: 'geldar_plan_seconds_total',
  throttleWaits: 'geldar_plan_throttle_waits_total',
  seenFlushBytes: 'geldar_seen_flush_bytes_total',
  seenFlushes: 'geldar_seen_flushes_total',
  queueDepth: 'geldar_plan_queue_depth',
} as const;
