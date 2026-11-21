# 0353. Body metrics are aggregate, and every pushing process carries a random instance id

- Status: Accepted (owner's step-3 approval of 2026-11-20, relayed by the orchestrator)
- Date: 2026-11-20
- Spec: none edited. Telemetry scope is set by 0088 (labels) and 0350 (events and spans); this record applies them to the player host's Body metrics (telemetry packet G3).
- Related: 0088, 0350 (point 7), 0352

## Context

G3 makes the player host push its Body metrics (`geldar_body_connected`, `geldar_tps`, `geldar_tick_lag_ms`, `geldar_wakeups_total`, `geldar_action_outcomes_total`). There is one Body per ranger, so many processes push the same metric names. Two questions were open: whether per-agent detail belongs in metrics, and how processes keep their series apart without a player or life label.

## Decision

1. Body metrics are aggregate. No metric label names a player or a life. The registry refuses such a label when it is declared (0088 holds).
2. Every pushing process carries a random `service.instance.id` resource attribute, drawn once when the process starts. It is never derived from a player, a life or a host name, and it is never logged with one, so processes do not overwrite each other.
3. Per-agent detail is not a metric. It goes as operator-only events that carry `player_id` (0350 point 7 joins spans by player id and time). That path is a later packet.
4. The aggregate counters for deaths, escape-ladder rung, stuck episodes, sleep outcome and eat outcome are deferred to G3b. G3 ships only the metrics listed above.

## Consequences

- Metric series never name an agent or a life, so the dashboards stay aggregate and the privacy rule of 0088 needs no exception.
- Series from different processes do not collide, and a restarted process starts a new instance id.
- The managed player host (`golem/src/players/managed-main.ts`) starts the same telemetry. Its container does not yet receive `GELDAR_TELEMETRY_URL` from the body helper's template, so managed hosts push nothing until that follow-up is done.
