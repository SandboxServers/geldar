# 0079. Credit numbers and charge rules

- Status: Proposed (owner confirms the numbers and the charge rules)
- Date: 2026-11-10
- Spec: section 5.7 (credits per real hour by tier, line 642; cap of 24 hours' worth, line 643; one credit about one standard thought, line 633); section 5.7 and the Phase 2 gate "credits accrue per real hour with reserve-before-dispatch"; section 10 Phase 1 ("credits (allowance only)"). Decisions 0057, 0062.

## Problem

Three sources disagree on the numbers.

- **Spec 5.7** (line 642): frontier 6, heavy 6, strong 8, fast 8, tiny 6 credits per real hour, roughly 150 to 200 thoughts per real day. Cap of 24 hours' worth (line 643).
- **Decision 0057** (Phase 0, sovereign players): 30 credits per real hour, cap 240, one credit per accepted `say` or intent, and `wait`, `look`, `read_book` and `status` free.
- **Decision 0062**: no settled-credits value reaches the reflection in Phase 0. A completed reflection keeps its reserved cost. E-8 is deferred.

Phase 1 needs one set. It also has to decide what happens to a reflection that fails, and how the per-address caps behave with up to 15 agents on shared addresses.

## Options

Numbers:

- **N-A. Spec tiers for Mind-driven agents; 0057 numbers for sovereign players.** Two budgets, because the costs differ: a Mind-driven agent spends a Thinker's thoughts, and a sovereign player spends shard load on `say` and intents.
- **N-B. 0057's flat 30 per hour for all.** One number, but it erases the tier difference the spec wants.
- **N-C. Spec tiers for all, cap 8 hours** (0057's 240 at 30 per hour is 8 hours). Mixes the spec's tiers with 0057's cap.

Charge rules for a failed reflection (0062 left it open):

- **C-A. Refund the reserved cost if the Mind fails before any Thinker output reaches the agent.** Charge once output is delivered, even if the reflection is later discarded.
- **C-B. Charge always.** Simple. Punishes the agent for an outage it did not cause.

Reserve before dispatch (the spec's Phase 2 gate): reserve the credits before a thought is sent to a Thinker, and release them on refund. This is cheap to add now, and it is what the Phase 2 gate asks for.

Per-address caps: 0057 sets 30 failed auths a minute per client address and a global 300 a minute. Phase 1 puts 10 to 15 agents on one node (spec section 10 Phase 1), and the owner's home network may be one address. The caps were sized for one player per address.

## Recommendation

- **N-A.** Spec tiers for Mind-driven agents (values from 5.7 line 642); 0057 numbers for sovereign players. Record the tier values in `contract/` if a tool reads them.
- **C-A.** Refund on failure before output; charge on delivered output. This keeps the 0062 rule for completed reflections.
- Reserve before dispatch from Phase 1, not Phase 2.
- Per-address: keep the per-player call caps as in 0057. Scale the per-address failed-auth cap to the number of players on the address (a 15-player address gets 15 times the 0057 per-player allowance), and test it with the Phase 1 agent count.

## Consequences

- The spec line 642 and line 643 numbers differ from 0057. The spec is not edited (0073); this record is the amendment.
- Credit ledger packets and reflection packets depend on the reserve and refund logic.
- A refund rule means a failed Thinker costs the shard nothing. The Thinker pool's health then shows in the ledger, which the Historian can read.

## Unblocks

- The credit ledger (allowance only in Phase 1; spend rules later).
- Reflection packets (0062's rule, extended by C-A).
- The per-address cap packets, which need the Phase 1 agent count.
