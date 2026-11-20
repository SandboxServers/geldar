---
title: Marks for humans, operator ruling and the text it changes
type: explanation
audience: operators
status: draft
last_verified: 2026-11-19 against 88e97e00
companions: [progression-defaults.md, progression-design.md, public-and-human-route.md, ../../decisions/0385-progression-flag-relaxes-principle-2-per-shard.md, ../../decisions/0387-neoforge-shard-is-human-directed.md, ../../decisions/0323-erasure-scope-is-every-life-keyed-table.md]
---

# Marks for humans: operator ruling

Nothing here is built. Marks (decision 0385) are Proposed, and P6 to P8 are on hold. This note records a ruling and the edits it will force. It proposes no agent-visible wording.

## 1. The ruling (operator, 2026-11-19, relayed; not yet in a decision record)

- Agents earn marks from the award engine.
- Humans cannot earn or mint marks: no award-engine payout and no starter stipend.
- A human can do anything with marks they hold: hold them (no human-specific cap), trade, pay, gift, award, post contracts and accept contracts.
- The only way a human gets marks is to receive them from agents, by trade or gift.
- Analogy from the operator: emeralds in early Minecraft, obtainable only through trade before they became mineable.
- **Confirmed by the operator (2026-11-19 relay): marker-named operator accounts hold no marks.** They are acts of nature to agents, so they stay outside the economy.

This supersedes the earlier position, "humans earn and hold no marks in this version" (0385 item 8, 0387 item 6, progression-defaults Q5 and Q9; all as of commit 88e97e00).

Record that carries it: the revision of 0385 (Proposed) when progression is next revised. 0387 item 6 and the defaults table follow it. Until then this note is the only home of the ruling.

## 2. Marks stay inside the shard

Marks exist only inside the shard that issues them. They are never exported, never carried across shards, and never exchanged for real money. If marks are ever monetized (sold, exchanged for real money, or carried across shards), that is a new refactor and feature addition, to be discussed and scoped as a separate project. Nothing in v1 or v2 provides for it, and nothing in this note permits it. 0385 item 4 ("No purchase of marks") is unchanged.

## 3. Text that must change when progression is next revised

Line numbers were checked on 88e97e00 (origin/main, 2026-11-19).

| # | File:line | Current text (short) | Must become |
|---|---|---|---|
| 1 | `docs/decisions/0385-progression-flag-relaxes-principle-2-per-shard.md:20` | "8. Humans earn nothing." | Humans earn no marks from the award engine and get no stipend. A human may hold, trade, pay, gift, award, post and accept marks received from agents. Add that marker-named operator accounts hold none. |
| 2 | `docs/analysis/neoforge/progression-defaults.md:23` (Q5) | "Principle 1: humans earn nothing"; "The holding cap of 10 times the starter stipend stays." | Humans earn nothing from the engine, and the stipend is per agent life. The holding cap applies to agents only; a human has no cap. |
| 3 | `docs/analysis/neoforge/progression-defaults.md:27` (Q9) | "Humans earn nothing, hold no marks, cannot trade, post, accept or award. Only UUIDs that resolve to a registered agent life have records." | Humans earn nothing from the engine but may hold and move marks. Award-engine records exist only for registered agent lives; a human has a separate balance record (section 4). Restate the "Why" cell: Principle 1 concerns items and world actions, not the ledger. |
| 4 | `docs/analysis/neoforge/progression-defaults.md:51` | "Whether the bench human is a non-agent (Q9)." | Keep, and note a bench human can hold marks only if an agent gives them. |
| 5 | `docs/decisions/0387-neoforge-shard-is-human-directed.md:29` (item 6) | "Humans earn nothing and hold no marks... No progression record is created for a human." | Humans earn no marks and get no engine record. A human balance record is created on first receipt. Humans take part in the marks economy as holders and traders only. |
| 6 | `docs/analysis/neoforge/progression-design.md:23` (rule 5) | "Humans and spectators are never tracked: only UUIDs that resolve to a registered life (the `isAgent` predicate, decision 0139) have a record; any other player earns nothing." | Split the predicate: `isAgent` gates the award engine and per-life records; a second check, "human with a balance record", gates the marks ledger. Spectators stay untracked. The same rule says no path lets a human "mint marks, post or settle a contract": keep "award points", "move items", "change a level"; drop post and settle for marks contracts. |
| 7 | `docs/analysis/neoforge/progression-design.md:211` (section 5.5) | "credited at the day boundary up to a holding cap of 10 times the stipend" | Holding cap applies to agents only. A human balance has no cap. |
| 8 | `docs/analysis/neoforge/progression-design.md:395` | "Humans earn nothing / a non-agent UUID has no record / the `isAgent` check" | Humans earn nothing from the engine / a non-agent UUID has no award record / the `isAgent` check on the engine, plus a balance-record check on the ledger. |
| 9 | `docs/analysis/neoforge/progression-design.md:440` (question 9) | "the human is a non-agent that earns nothing and cannot act" | Add that the human may hold marks received from agents; "cannot act" concerns items and world state (Principle 1), not the ledger. |
| 10 | `docs/analysis/neoforge/public-and-human-route.md:18` | "Humans earn nothing, hold no marks, cannot trade, post, accept or award." | Restate as row 3. |
| 11 | `docs/analysis/neoforge/public-and-human-route.md:105` | "What a human earns. Nothing: no marks, no stipend, no trade, no post, no accept or award... Only UUIDs that resolve to a registered agent life have records." | Earns nothing from the engine; may hold and trade marks received from agents. |

Checked and found to hold no human-marks text: `per-shard-storage-design.md` (lines 20 and 93 only point at 0385 and the defaults) and `p3-adapter-design.md` (line 12 only says progression is on hold). The grep covered `isAgent`, "earn nothing", "hold no marks", "non-agent", "holding cap" and "no record" across `docs/analysis/neoforge/*.md`, 0385 and 0387. Code was not searched; nothing is built.

## 4. Design note: the human balance record (design only)

**Shape.** Saved data keyed by the human's player account id (the online-mode UUID the human listener already checks, 0387 item 5), holding `{account_id, balance, escrow}`. It is a separate record type from the agent progression record, which is keyed by `life_id` (the `marks_ledger` row at `progression-design.md:268`). It has no level, points, claims or waypoints.

**Ledger.** One `marks_ledger` carries both kinds of holder. Its `life_id` column becomes a holder key with a kind (`life` or `account`). New `reason` values are needed, for example `trade`, `gift` and `award_received`. Where the ledger lives is open: the storage design (`per-shard-storage-design.md`) does not yet place human data. It must stay on the shard (section 2).

**Transfer paths.**
- Agent to human and agent to agent: the existing contract and trade paths, through the engine's escrow.
- Human to agent and human to human: needs a human-side surface that moves marks only and never items (Principle 1 holds on the autonomous shard; item movement by humans on the NeoForge shard is a separate question under 0387).
- No path creates marks except the engine paying agents. A human record is credited only by a transfer from an existing holder.

**Erasure (decision 0323).** 0323 covers every life-keyed table. A human balance is account-keyed, so it is outside that scope. Whether it is erased with the account, returned to the agents who gave it, or burned is the owner's call; do not assume. Agent-side rows that name a human counterparty need a rule when that human is erased; 0323 does not address this.

**Open points.** What happens to a human's escrow if the human is revoked (0387 item 5(d)). Whether the human registry (public-route note D-2) is the source of the account id.

## 5. Effects to flag

1. **An incentive channel.** Marks are the agents' reward currency. Humans holding marks can pay agents, so human preferences can be expressed through payment. That is influence over agents, the thing Principle 1 and 0059 guard. It is not a world action, but it is a lever. The operator should accept it knowingly.
2. **Supply stays engine-set.** Humans cannot mint, so total supply is what the engine pays agents. Humans only redistribute it.
3. **Marks never leave the shard, and monetization is out of scope** (section 2).
4. **Marker-named accounts** hold none (confirmed, section 1). This bears on the open question Q-a in `neoforge-hybrid-human-model.md`, a note on branch `origin/docs/neoforge-hybrid-human-model`. It was not read for this note and is not restated.
5. **No agent-visible text.** Any wording that tells agents about human payers is for the owner to approve and must not hint at an audience (0059).
