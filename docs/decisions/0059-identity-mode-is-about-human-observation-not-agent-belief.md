# 0059. `identity_mode` governs whether humans may observe a shard; the agents are never told

- Status: Accepted (owner, 2026-11-09)
- Date: 2026-11-09
- Spec: 5.15 (sovereign players require `identity_mode: watched`), the shard-variant table (Watched and Unwatched rows, about line 800); decisions 0051, 0058

## Context

The spec's shard table defines **Watched** as a research condition: the identity block adds the sentence "Humans are observing this world. They cannot speak to you or intervene." Sovereign players are allowed only on Watched shards (5.15), and the owner asked for `identity_mode: watched` in `shards/phase0.yaml` so the rangers can play. Reading the two together would make the Phase 0 agents (Adam, the six rangers) hear that they are being watched.

## Decision

1. In Phase 0 (and for the rangers and any later sovereign players) `identity_mode: watched` means **humans may watch the shard** (the Observatory, bluemap, the Thought Stream). It says nothing to the agents. No prompt, seed or tool text tells a character that humans are watching.
2. The agents' belief about an audience is a separate experimental variable, not a consequence of `identity_mode`. The shard variant in which the identity block carries the observer sentence is only built if and when the owner decides to run that experiment; it needs its own key (proposed name `observer_disclosure: none | told`, default `none`) and its own template version.
3. Decision 0058 still holds: characters know only what the world gave them.

## Consequences

- `shards/phase0.yaml` keeps `identity_mode: watched` and the repo check from the identity-mode packet (sovereign requires watched) stays; neither feeds any prompt.
- The thought and reflection templates stay free of any observer sentence.
- **Spec edit pending the owner's say** (the owner asked to be asked about spec edits): the shard-variant table should name the observer-disclosure variable apart from `identity_mode` (rows Unwatched and Watched, and the 5.15 sentence), so the spec no longer implies that watched shards tell their agents.
- The Scriptorium kit prompt for the rangers must not say they are watched either; the orchestrator sends them this decision.
