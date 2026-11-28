# 0390. Marker-named operator accounts read as acts of nature; ordinary NeoForge humans are named equals (supersedes 0329 once accepted)

- Status: Accepted (operator ruling, 2026-11-27, given in the sheet coordinator session; see [0289](0289-operator-rulings-2026-11-27-sheet.md)). Supersedes 0329; 0329 is not edited. Nothing is activated; NF twin and filter cards stay frozen until re-dispatched.
- Date: 2026-11-19
- Spec: none edited. Section 2 Principle 1 (no humans inside) and Principle 4 (everything is recorded) are read only; the spec text is the operator's to edit (0073).
- Related: 0329, 0387 (item 5), 0388, 0137, 0059, 0058, 0068, 0375, 0385; [the plan and card table](../analysis/sheet/neoforge-hybrid-human-model.md)

## Context

0329 recorded NF-1 to NF-6 (players and agents are equals on NeoForge). The operator then flagged an "invisible hand" revision, and on 2026-11-19 gave the model below. The existing marker-word guard (`MARKER_WORD`, `markedWords`, `contract/src/agent-text.ts`) already decides which words must not reach an agent.

## Decision

1. **Marker-named operator accounts are a deliberate convention.** When the owner or the operator must intervene by hand (unblock a robot, gather telemetry), the account is named with a marker word. By the guard, agents then perceive that account's actions as an act of nature: no name, no alias, no theory-of-mind model, effects unattributed. It is not a player class chosen by opt-in or detection.
2. **One predicate.** `isMarkerNamed(username)` is true when the guard finds a marker word in the name. It is exported from one place (recommended: `contract/src/marker-named.ts`, beside `agent-text.ts`) and replaces any life-id or registry predicate. The Body suppresses name, targeting, chat attribution, image and MCP naming for a marker-named player on both shards. It reads the username only.
3. **Paper** is robots only and fully autonomous, with no ordinary human connected; humans only watch. The one exception is a marker-named operator account used for a manual intervention. That is an exception to Principle 1 that this record does not grant: it needs the operator's separate, bounded and temporary ruling. Principle 4 applies: each intervention is recorded and labelled (what, when, which operator account) where agents never see it. The mechanism is OPEN (Q-d).
4. **NeoForge:** nobody uses a marker name by default. Ordinary humans are regular players in cohort with bots: named equals with proximity chat (the owner's 2026-11-19 position). NF-1 to NF-6 of 0329 stand largely as ruled: names visible, NF-2 attacker named, NF-3 container taking inactive, NF-4 kill credit to the killing blow, NF-5 proximity chat, NF-6 human block owners logged by name. Humans earn no marks this version (0329 Q7); the provenance feed is skipped for v1 (0329 Q1). The change: a marker-named account is excluded from every naming rule above, and is logged by name in operator-side records only (Principle 4).
5. **Hand of god and serendipity stay deferred to v3** (`docs/ideas.md`). This record does not build or forbid it.
6. **Wording.** Any agent-visible sentence about an unattributed cause ("something ...") is a labelled proposal in the plan note, not approved text.

## Questions (all answered 2026-11-27; each has a proposed default in the plan note)

- Q-a. Refuse ordinary NeoForge players whose name contains a marker word (default yes; reserves such names for operator accounts, like 0387 item 5 does for agent-shaped names). **ANSWERED, accepted: yes, refuse.**
- Q-b. A marker-named account's chat to agents (default suppressed entirely). **ANSWERED, accepted: suppressed entirely.**
- Q-c. How marker-named operator accounts connect to Paper, and who holds one (default: owner and the operator only, UUID allow-list, existing spectator route; acting needs a separate Principle 1 ruling). **ANSWERED, accepted: owner and operator only, UUID allow-list, spectator route; acting needs a separate Principle 1 ruling.**
- Q-d. The intervention-recording mechanism (default: labelled session window and acts in operator-only storage, plus an operator note). **ANSWERED, accepted: labelled session window and operator-only storage, plus an operator note.**
- Q-e. Whether a name-keyed `PlayerActor` is needed for ordinary named humans (default: keep NF-2 as ruled; alternative: defer). **ANSWERED, accepted: keep NF-2 as ruled.**
- Q-f. Agents may attack ordinary named humans (confirm). Q-g. No Paper switch (default). **Q-f ANSWERED, accepted: agents may attack ordinary named humans. Q-g ANSWERED, accepted: no Paper switch.**

## Why

The guard already exists and is what keeps observer wording away from agents; reusing it makes an operator's hand invisible as a person without a second mechanism, and leaves ordinary NeoForge players as equals, which is the experiment 0387 set up.

## Consequences

- A blunt classifier: it matches inside words, so an ordinary `Colonel` or `Streamer` would become nature unless Q-a is accepted. A player can pick or avoid such a name.
- An agent username that contains a marker word would be hidden from other agents (UNVERIFIED whether any exists; the first predicate test checks).
- The seven filter cards shrink: the switch and the life-id pattern parity guard are dropped; the card-by-card table is in the plan note. Nothing is dispatched.
- Banners on 0329, `neoforge-delta.md`, the sheet RESUME and the ledger describing the invisible-hand model, and the `docs/ideas.md` hand-of-god row, need updating on acceptance.
- Paper changes only for marker-named accounts, which exist only as operator accounts.
