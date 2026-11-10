# 0065. Damage wakes the Mind when no intent is running; death still ends the life

- Status: Accepted provisionally (orchestrator, owner may revise)
- Date: 2026-11-10
- Spec: 5.3.1 (wake_on, the Body asks the controller), 5.3.2 (coalescing, spacing, one thought in flight), 5.9 (permadeath and the life)
- Packet: W6-26 (smoke run smoke-w6-25-a: the Mind never woke on damage, and the idle watchdog ended at a death)
- Worknote: docs/analysis/phase0/worknotes/w6-26.md

## Context

With no intent running, the Body watches no `wake_on` condition, so `unexpected_damage` never fires
(golem/src/body/wake-conditions.ts:37-44). The Mind ignored the `damage` events it received
(animus/src/attention/controller.ts, the default branch). A Mind whose intent ended, and whose reflexes
gave up, could be hit for 50 seconds and never think.

The spec does not say whether the Mind must wake on damage while idle. It does say a wake is
coalesced and rate-limited (5.3.2). Death is permanent for a life (spec 1579, 1418).

## Decision

1. A `damage` event becomes an `unexpected_damage` candidate in the Mind's controller. The first hit
   opens a 1 s window (`DAMAGE_BURST_MS`), and every hit inside it is one candidate with all its events.
   The existing spacing and one-thought-in-flight rules then bound the model calls.
2. The candidate carries the active intent id, if one runs. A Body `unexpected_damage` wake for the same
   intent folds into it through the pending set.
3. Death keeps ending the life: the controller goes quiet (`ended`), so damage after a death and the
   idle watchdog stay off. A death is not a wake. A new life has its own Mind.
4. Idle is unchanged: 60 s after a settled thought with nothing running.
5. A damage burst that closes during an in-flight thought is dropped (recorded `coalesced_in_flight`),
   not re-raised after the thought settles. The idle watchdog is the only follow-up.

## Consequences

- A damage burst is one wake, not one model call per tick.
- A hit taken during a long thought does not wake the Mind again once that thought settles.
- Damage with no intent now wakes the Mind; before, it did not.
- A run whose life dies still idles until the harness's no-thought rule ends it. That is the
  intended behaviour of a permadeath life, not a hang.
