# 0343. Observed evidence: visible-actor attribution and provenance subjects

- Status: Proposed
- Date: 2026-11-18
- Spec: D-CS-06 and OD-E (open; not ruled). Settles only the contract shape the character-sheet observation work (AN-24) needs.
- Why: a Body should know who gave it an item or broke its block, but only when that person is a visible causal actor. The plugin sees the actor of a break and a pickup; the Body sees only what is in sight. Raw server facts must not reach the agent unfiltered.
- What (1), attribution: an observation carries an `actor` (name and life) only when a visible player caused the event. Otherwise the observation has no actor and stays unattributed. `ObservedActor` requires both `name` and `life`; no name-keyed or human actor kind exists.
- What (2), provenance: `geldar.<shard>.provenance.break` and `geldar.<shard>.provenance.pickup` are raw infrastructure messages (schema `provenance.schema.json`). They are Body-only, never agent-facing, and sit outside the sink's `geldar.*.*` filter (four tokens). A Body turns one into an observation only through its own rules.
- What (3), hurt: the hurt event gains an optional `actor` (the visible player who hit). Falls, fire, starvation, mobs and invisible attackers carry none.
- What (4), wording: `observationSentence` gives two agent-visible sentences and a generic one. The wording is unapproved (OD-E). It never reads an actor, so a name never enters the text. Nothing calls it until the observation activation is ruled.
- Not in this record: activation (D-CS-06, OD-E), any publication of observations, the human or name-keyed actor kinds, and any exemption from the marker-word scan. No world change. `docs/spec.md` is not touched.
