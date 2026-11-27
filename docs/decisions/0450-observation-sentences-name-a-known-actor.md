# 0450. Observation sentences may name an actor the agent could legitimately perceive

- Status: Accepted for the rule (operator ruling, 2026-11-27, given in the sheet coordinator session). The exact sentences below are Proposed until the owner approves them. Nothing is activated.
- Date: 2026-11-27
- Spec: OD-E (observation wording). `docs/spec.md` is not touched.
- Amends: 0391 item 2, where it says "Naming a visible actor in the agent's text is the intended next version, not this one. It needs its own record". This is that record.
- Related: 0343 (observed evidence, ObservedActor), 0345 (fight_seen, container_taken), 0390 (marker-named accounts), 0058 (knowledge boundary), 0059 (agents never told they are watched), 0068 (agent-visible text), 0281, the held-live ruling of 2026-11-15.

## Decision

1. **The rule.** An observation sentence may name the actor when it is appropriate for the agent to know who did the thing, because the agent could legitimately perceive it: the actor was in the agent's view, spoke in chat, or signed a sign. Otherwise the sentence stays actor-free ("Someone ...").
2. **Marker-named accounts stay "Someone"** (0390 item 2). A name for which `markedWords` finds a marker word is never shown; the sentence is built as if no actor were known.
3. **No id is ever shown.** No `ag_` life id, player UUID or entity id appears in a sentence (0391 item 4). Only the name does.
4. **The visibility test uses the existing ObservedActor evidence** (AN-24), and a sentence names an actor only when that evidence is present and passes `visibleActorName` (a Minecraft username with no marker word).
   - What the evidence carries: `ObservedActor` is `{name, life}`, both required (`contract/schemas/observation-event.schema.json`). It is built by `observedActor` in `golem/src/perception/provenance/visible-actor.ts`, which returns null unless the exact username belongs to a player the Body sees right now (`isUsernameVisible`, within entity range with some part of the body in sight; decision 0446 covers "in sight"). It is absent for an unseen actor, the Body itself, or a non-username.
   - What it lacks: it records no basis. Nothing says whether the name was seen, heard in chat or read from a sign, so chat and sign evidence have no representation today. Only the visible case exists. (Verified from the schema and `visible-actor.ts`; whether any producer outside those named files sets an actor from chat or a sign is UNVERIFIED and believed not to exist.) It also requires a `life` id, so an actor with no registry life (an ordinary human on NeoForge) cannot be expressed; how `lifeIdFor` answers for such a name is UNVERIFIED.
   - Until chat and sign evidence exist, only the "in the agent's view" limb of the rule is implementable. The other two limbs wait for the contract change in item 6.
5. **The wording stays the Body's.** The sentence is built from facts the Body perceived; it adds no coaching and no reference to the system (0058, 0059, 0068).
6. **What changes when this is built** (a later packet, not this record):
   - A contract change in a serial slot: an optional field recording the basis of an actor (proposed name `basis`, one of `seen`, `spoke`, `signed`), and chat and sign producers. It must take the next free contract regeneration slot after those in flight; ask the slot holder first. Whether the field is needed for the `seen` case alone is open: the shipped evidence already implies `seen`.
   - A presenter change: `observationSentence` in `contract/src/observation.ts` gains an optional `actor` input and builds the named sentence only when the actor is present and passes the tests in items 2 and 3; `threshold/mcp/src/events/handlers/observation.ts` passes `p.actor?.name` through `visibleActorName` into it; `present-handlers/observation.ts` already carries the name as a line field. The fight_seen and container_taken presenter rows (AN-50b finding 3) remain a separate card.
   - Leakage tests: the sentence with an actor passes `markedWords` for each kind; a marker-named actor (for example `Observer1`, `Streamer`) gives the "Someone" form; no sentence contains `ag_`, a UUID or digits beyond the count; an actor absent gives the exact current sentence; the existing marker-word scan of agent text still passes. Each test must fail when the guard it covers is removed.
7. **Proposed sentences (OWNER APPROVAL REQUIRED, not approved, not selectable).**
   - property_broken: `<Name> broke your <block>.`, falling back to the approved `Someone broke your <block>.`
   - container_taken: `<Name> took <count> <item> from your container.`, falling back to `Someone took <count> <item> from your container.`
   - fight_seen: `<Name> fought <a|an> <mob> nearby.`, falling back to `Someone fought <a|an> <mob> nearby.`
   - gift_received keeps `You received <count> <item>.` (its giver is not named; whether to add one, for example `<Name> gave you <count> <item>.`, is also Proposed).

## Why

An agent that can see, hear or read who did something would know it as a person does; hiding a name the agent already perceived would make it less able to form trust and reputation, which is what the sheet work measures. The limits keep out what it could not know: out-of-sight actors, operator hands, and any system identifier.

## Consequences

- Nothing is activated. The `observations` option stays absent in production, and the held-live ruling and D-CS-06 stand. Approving the rule does not select or publish any observation.
- 0391 item 2 stands for the approved sentences as written (actor-free) until the owner approves the Proposed ones and a packet changes the code.
- 0343 item 4 ("the sentence never reads an actor") is amended only when that packet merges.
- The number was free on `origin/main`, in open PRs and in remote branch names on 2026-11-27.
