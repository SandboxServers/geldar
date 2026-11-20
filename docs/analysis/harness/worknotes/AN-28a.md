# AN-28a worknote: delivery path to the player log

Status: code written; **inactive**. Nothing publishes an `observation` event, and no wake maps to it (`wake.ts` has no interest for `observation`, so `wait` never wakes on it).

Paper-only; do not enable on NeoForge until the human-handling question is decided.

## What changed

- `player-core`: `observation` added to `MindEvent` and `MIND_EVENT_TYPES`; the normaliser checks it with `validateObservationPayload` (a boolean validator, so it is called as a predicate). One fixture key `observation` in `link.fixtures.ts`; `observation-event.test.ts` (new).
- `threshold/mcp-mock`: `wake.ts` kind union gains `observation`; `events.ts` gains `observationKind`, `actor`, `item`, `count`, `block` on `SimEvent` (type-forced by the presenter).
- `threshold/mcp/src/events/handlers/observation.ts` (new): the sentence comes only from AN-24's `observationSentence`; the actor name is copied only when it matches `^[A-Za-z0-9_]{3,16}$` and `markedWords` finds nothing in it (`visibleActorName`). The life id and the key are never copied.
- `handlers/damage.ts`: copies `actor.name` through the same `visibleActorName` check. The fixed damage sentence is unchanged.
- `present-handlers/observation.ts` (new) and `present-handlers/damage.ts`: emit `type` = the observation kind (`gift_received` or `property_broken`), `text`, and the fields above.
- Registry lists extended: `handler-registry.test.ts`, `nats-event-source.test.ts` (twelve subjects), `stream.test.ts` (fifteen subjects). These are the consequence of one more Mind type, not weakened assertions.

## Wording

No new agent-visible wording. Observation text is `observationSentence` output only. The damage line is unchanged.

## Revert-checks

Not run in this session (tool budget). Planned, per the card: (1) drop `observation` from `MIND_EVENT_TYPES` (fails "observation is in MIND_EVENT_TYPES"); (2) copy `actor.life` into the presented event (fails the `ag_` scan); (3) skip the name re-check in `visibleActorName` (fails "a name failing the pattern ... is dropped"); (4) remove the damage `actor` copy (fails the attributed damage case).
