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

Card revert-checks, run in review 1 and recorded there: (1) drop `observation` from `MIND_EVENT_TYPES` (fails "observation is in MIND_EVENT_TYPES"); (2) copy `actor.life` into the presented event (fails the `ag_` scan); (3) skip the name re-check in `visibleActorName` (fails "a name failing the pattern ... is dropped"); (4) remove the damage `actor` copy (fails the attributed damage case). All four fail the named test.

Review-1 mutations (fix pass, each restored from a backup copy and checked with `git diff --stat`):
- Item guard removed (`const item = typeof p.item === 'string' ? p.item : undefined`): "an item or block holding a marker word is dropped and the event kept" fails (`item: 'watch'` leaks).
- Block guard removed (same shape for `block`): the same test fails (`block: 'observer'` leaks).
- Presenter `observationKind === undefined` guard deleted: "a fight_seen or container_taken observation maps and presents no line" fails. Before the fix this mutation survived (all six tests passed).
- Payload check replaced by a null-only check: "an unknown observation kind is invalid" and "a gift with a name failing the LifeId" both fail (`foo` is accepted). The first test now uses a valid key, so only the kind can cause `invalid`.
- Earlier review-1 mutations (pattern removed, marker check removed, pattern bounds, anchors, presenter field drops, literal text, forced type, handler stops setting kind, damage actor default) were run in review 1 and fail their named tests.

Owner decisions and open items:
- Item and block (review-1 note 1): a field holding a marker word is dropped and the event is kept with the generic sentence. This is the stricter inert choice, applied without an OD-E owner call. A field is dropped when the item or block name, read with underscores as spaces, holds a marker word after the Minecraft phrases (observer block, echo shard, happy ghast harness) are removed. So `observer`, `white_harness` and `amethyst_shard` give no field; `echo_shard`, `observer_block` and `happy_ghast_harness` keep it, as the sentence keeps them.
- `fight_seen` and `container_taken` are AN-24 kinds with no approved wording (AN-46). The presenter drops them: a valid one normalises to an event and maps, and gives no player line.
- `link.fixtures.ts` has one `observation` fixture; the other kinds are inline in the tests. Owner to accept.
- The five `SimEvent` fields in `mcp-mock/src/sim/events.ts` and the registry test edits outside the card list are owner-accepted as forced by the Mind type and the handler design. Owner to confirm.
- OD-E wording approval is still pending; no new agent-visible wording is added; the only agent-visible sentences are AN-24's `observationSentence` output and the unchanged damage text.
