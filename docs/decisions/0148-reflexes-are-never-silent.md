# 0148. Reflexes are never silent

Status: accepted in part (owner direction, C6 body events)

## Context

The mapper dropped every reflex firing except a completed eat. A retreat, a fall stop or an unstick
moved the agent without any news, so position jumps looked like bugs (jason-run defect D5).

## Decision

- Every reflex firing is a news entry for the player: the mapper keeps every `reflex_fired`
  (name and result), and the presenter prints a fixed line per known reflex name
  ("Reflex fall_stop: you were falling, you braced."). An unknown name prints only the generic
  line; no world text is copied.
- A firing that did not finish says so ("It did not finish.").
- The retreat reflex walks only to solid ground near its safe spot, and stays to fight when there is
  none (no walk into a canopy).

## Not yet done (owed under this decision)

- Rate limit: identical repeats to one per N seconds with an "x3" counter.
- The Record / eventsink structured event for each firing (timestamp, agent id, reflex name) so the
  body's activity is auditable. Until this lands the firings are visible to the player only.
- The displacement a reflex caused (for example "goto interrupted") on the action in flight.
