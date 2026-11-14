# 0214: Rest in bed: reflexes are suspended while the Body sleeps

Status: Accepted (owner approval for the campaign).

## Context

The Body sleeps in a bed at night (the `sleep` action). In the live runs it made 662 ok sleeps a
day, but the next action after a sleep was `goto` in 289 cases, with a median of 92 s between the
two. The reflexes woke the sleeper: a reflex runs its own action, and an action first wakes a bot
in bed (`STAYS_IN_BED` in `golem/src/actions/registry.ts`). So a Body that had gone to bed to rest
was up again within seconds, often for a reflex that had nothing to do with the rest.

## Decision

While the Body is asleep, the reflexes that are about its surroundings do not run:

- `eat`, `blocked_path`, `unstick`, `idle_stuck`, `dark_shelter` and `panic_burrow` are suspended
  while asleep (`suspendedWhileAsleep` on the `Reflex` interface).
- `fall_stop`, `fight_or_flee`, `retreat` and `hazard_escape` are not suspended: they keep running
  while the Body sleeps.
- A suspension ends when the Body took damage in the last 20 ticks, inclusive (21 ticks ago does
  not count). The damage source is `view.ticksSinceHurt`, the one `panic_burrow` reads.
- `eat` has one more exception: it is suspended only while hunger is above 4. A sleeper at hunger
  4 or below eats.
- `wait` and `note` keep the Body in bed (they do not wake it). Every other action wakes it first,
  as before (`goto`, `mine`, `craft`, `give` and the rest).

The awake behaviour of every reflex is unchanged.

## Consequences

- A Body that sleeps at hunger 5 or more does not eat until it wakes. The risk is accepted: the
  hunger reflex wakes at 4 or below, and a Body that is hurt wakes for the damage rule.
- Unstick, blocked-path and panic burrow do not act on a sleeping Body. Idle-stuck and the
  dark-shelter unstick already require an awake Body (`mayUnstick`), so damage does not free a
  sleeper through them. Damage frees a sleeper by lifting the suspension of the other reflexes
  (for 20 ticks), and the unsuspended fight_or_flee, retreat and hazard_escape run regardless; either
  one wakes the Body. A Body stuck in bed is freed when it wakes.
- The Mind still wakes the Body with any action other than `sleep`, `wait` and `note`.
- Idle-stuck's clock is no longer refreshed while the Body sleeps (the reflex is suspended). On
  waking within half a block of its old anchor, it may fire up to a minute earlier than before.
  Accepted: low severity, unconfirmed live.
