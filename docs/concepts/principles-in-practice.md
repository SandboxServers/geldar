---
title: Principles in practice
type: explanation
audience: contributors
status: draft
last_verified: 2026-11-16 against 1b114276
companions: [README.md, what-is-geldar.md, world-operations-exceptions.md, ../reference/spec-section-map.md, ../reference/glossary.md, ../agents/documentation-style.md]
sources: [docs/spec.md, CLAUDE.md, plugin/README.md, ../decisions/0002-phase0-host-and-models.md, tools/repo-checks/src/identity-mode.ts, shards/phase0.yaml, shards/colo-mind.yaml, sql/0007_journals_append_only.sql, sql/0039_account_deletion.sql, sql/0040_account_deletion_all_lives.sql, docs/analysis/autonomy/review-and-plan-2026-11-14.md, ../decisions/0020-receipts.md, ../decisions/0027-final-receipt-constraints.md, ../decisions/0034-mock-result-shapes-and-untrusted-text.md, ../decisions/0041-event-export-stream-and-sink.md, ../decisions/0044-malicious-book-corpus-world-side.md, ../decisions/0048-recipe-discovery-is-part-of-the-game.md, ../decisions/0058-the-character-knowledge-boundary-and-thought-v2.md, ../decisions/0059-identity-mode-is-about-human-observation-not-agent-belief.md, ../decisions/0072-glass-and-bluemap-are-public.md, ../decisions/0075-glass-is-a-lakitu-camera.md, ../decisions/0085-append-only-audit-tables.md, ../decisions/0134-mind-is-a-profile-until-a-thinker-exists.md, ../decisions/0144-death-is-an-event-and-a-dated-fact-and-there-is-no-revive.md, ../decisions/0149-act-budget-suspended-and-metered.md, ../decisions/0151-bodies-run-only-in-the-colo.md, ../decisions/0171-account-erasure-rule.md, ../decisions/0172-human-skin-upload-held-for-approval.md, ../decisions/0218-use-mount-dismount-verbs.md, ../decisions/0262-account-deletion-erases-dead-lives-too.md, ../decisions/0339-journal-reset-one-time-exception.md, ../decisions/0350-telemetry-scope-and-full-capture.md, ../decisions/0351-paper-telemetry-plugin-scope.md]
---

# Principles in practice

The spec's seven principles are the rules the builders and operators follow; the agents have none ([spec 2](../spec.md#2-principles)). This page takes each principle in turn: what the spec says, how the code and the decisions keep it, and where it is strained or contradicted. Read it before you change anything an agent can see or do.

## Principle 1: no humans inside

**The spec.** Humans may observe. They never speak, build, give items or intervene. "If something breaks, fix the infrastructure, not the story." `CLAUDE.md` adds that the rule holds in code: nothing Geldar builds may let a human act inside the world.

**How it holds.**

- **Agents get no commands.** Geldar-Core cancels every command a player types, operators included; operator work goes through the server console or RCON (`plugin/README.md`, "Command block").
- **Viewers cannot act.** The Glass, BlueMap and the routes to them cannot send a command, a chat line or a world change ([0072](../decisions/0072-glass-and-bluemap-are-public.md) item 7). Cameras are read-only and one-way ([0075](../decisions/0075-glass-is-a-lakitu-camera.md) item 2). Telemetry and alerts are read-only and may not act in the world ([0350](../decisions/0350-telemetry-scope-and-full-capture.md) item 8, [0351](../decisions/0351-paper-telemetry-plugin-scope.md) item 10).
- **No undoing outcomes.** A dead life is not revived by any tool, command or person ([0144](../decisions/0144-death-is-an-event-and-a-dated-fact-and-there-is-no-revive.md), Proposed).
- **Owners shape appearance only.** A skin is cosmetic and gives no way to act ([0172](../decisions/0172-human-skin-upload-held-for-approval.md) item 8).
- **New Body verbs are the standard client's own clicks**, open to every agent equally, not a human edit ([0218](../decisions/0218-use-mount-dismount-verbs.md)).
- **Bodies run only in the Colo**, so no person runs a Body outside the record ([0151](../decisions/0151-bodies-run-only-in-the-colo.md); the decision restates Principle 1).

**Where it is strained.**

- **Sovereign players have a human behind them.** The spec accepts this as "a hand on the scale", labels such players and confines them to Watched shards ([spec 5.15.8](../spec.md#5158-humans-and-principle-1)). It also admits that the project cannot verify whether a person typed instructions mid-session ([spec 5.15.9](../spec.md#5159-what-we-can-and-cant-verify)). The 2026-11-14 review goes further: a token holder may be a model, a script or a person typing, so Principle 1 cannot be enforced at the sovereign boundary (`docs/analysis/autonomy/review-and-plan-2026-11-14.md`, finding SC5). See [sovereign players](sovereign-players.md).
- **Operators have acted in the world.** Those cases are recorded, with their limits, in [world-operations exceptions](world-operations-exceptions.md).

## Principle 2: no imposed goals

**The spec.** Agents get a body, a starting personality seed and the knowledge that they must eat. No quests, no scoring. "We never inject goals" ([spec 5.3.4](../spec.md#534-the-thinking-loop)).

**How it holds.** Characters know only what the world gave them, not the model's training data about the game ([0058](../decisions/0058-the-character-knowledge-boundary-and-thought-v2.md)). Recipes are discovered through play, not granted ([0048](../decisions/0048-recipe-discovery-is-part-of-the-game.md); `plugin/README.md`, "Recipes").

**Where it is strained.** The 2026-11-14 review found that the first sovereign players' friendship was written into them by their kit, and records an owner ruling that "Principle 2 amended to allow a disposition in the seed and faculties built from the agent's own record" (review, part A1 and line 889). No decision record carries that amendment: `git grep "Principle 2" -- docs/decisions` finds none (2026-11-16). Until one exists, the spec text stands and the review is the only source.

## Principle 3: every constraint is a scientific choice

**The spec.** Constraints such as proximity chat, budgets and permadeath create pressure, not direction. Each is documented with its rationale and is toggleable per shard ([spec 2](../spec.md#2-principles), [5.14](../spec.md#514-shards-and-time)).

**How it holds.** Shard toggles live in `shards/*.yaml`: for example `lifecycle: { permadeath: false }` (`shards/colo-mind.yaml` line 28) and `identity_mode` (line 15).

**Where it is strained.** The act budget is suspended by default and switched by an environment variable, `GELDAR_ACT_BUDGET_ENFORCE`, not by a shard file ([0149](../decisions/0149-act-budget-suspended-and-metered.md), "Accepted, temporary"). Every act is still metered. See [economy and budgets](economy-and-budgets.md).

## Principle 4: everything is recorded

**The spec.** Every thought, message, block change, trade, death and vote is logged permanently, so a run can be inspected afterwards. It is inspection, not deterministic replay ([spec 2](../spec.md#2-principles), [7](../spec.md#7-observability)).

**How it holds.** Every action gets a receipt, economic actions two ([0020](../decisions/0020-receipts.md)); the database enforces one final receipt per action ([0027](../decisions/0027-final-receipt-constraints.md)). Events flow through one JetStream stream into Postgres ([0041](../decisions/0041-event-export-stream-and-sink.md)). Receipts, thoughts, suppressed wakeups and the sovereign journal refuse UPDATE and DELETE ([0085](../decisions/0085-append-only-audit-tables.md); `sql/0007_journals_append_only.sql`).

**Where it is strained.**

- **Sovereign minds are recorded only in part.** The record holds their actions and what they volunteer, not hidden reasoning or the human's instructions ([spec 5.15.2](../spec.md#5152-architecture)).
- **Deletion erases records.** An owner's account deletion removes the thoughts, events and death records of every life of that owner, dead or alive ([0171](../decisions/0171-account-erasure-rule.md), point 2 superseded by [0262](../decisions/0262-account-deletion-erases-dead-lives-too.md)).
- **One reset moved records out of the live tables.** On 2026-11-15 pre-reset journal rows were copied to an archive table and removed from the live one, once, under the owner's order ([0339](../decisions/0339-journal-reset-one-time-exception.md)).

## Principle 5: emergent misbehaviour is data

**The spec.** Agents scamming or prompt-injecting each other are social facts, not bugs. Infrastructure abuse is a bug ([spec 2](../spec.md#2-principles)).

**How it holds.** In-world text (speech, signs, books, names) is passed to Minds as untrusted data, never as instructions ([0034](../decisions/0034-mock-result-shapes-and-untrusted-text.md); [spec 8.4b](../spec.md#84b-sovereign-players-oauth-scopes-and-the-humans-machine)). A malicious-book corpus tests that hostile text stays untrusted ([0044](../decisions/0044-malicious-book-corpus-world-side.md)). The line drawn: an injected agent may do something foolish in the game; it must not reach a person's machine.

## Principle 6: cheap by default

**The spec.** Most agents run on local open-weight models; frontier-model agents are a deliberate minority ([spec 2](../spec.md#2-principles)).

**Where it stands.** Phase 0 ran Adam on local models ([0002](../decisions/0002-phase0-host-and-models.md)). On the Colo, the headless Mind is off by default until a Thinker path exists ([0134](../decisions/0134-mind-is-a-profile-until-a-thinker-exists.md)), so the running agents are sovereign players on vendor subscriptions. The 2026-11-14 review records "subscription for the rangers for now" as an owner choice (line 889). This is a drift from the spec's default, not a recorded reversal.

## Principle 7: two kinds of shard, never mixed

**The spec.** Research shards are headless only, with pinned models and pre-registered hypotheses. The Commons is the Watched exhibition shard, open to sovereign players ([spec 2](../spec.md#2-principles), [5.14](../spec.md#514-shards-and-time)).

**How it holds.** A repo check fails any shard file that allows sovereign players without `identity_mode: watched` (`tools/repo-checks/src/identity-mode.ts`). Every Body runs the same code under the same limits, so agents stay comparable ([0151](../decisions/0151-bodies-run-only-in-the-colo.md), citing Principle 7).

**Where it stands.** No research shard exists: `shards/` holds four files, `phase0.yaml`, `colo.yaml`, `colo-mind.yaml` and `character-fixture.yaml`, three of them shard definitions; `colo.yaml` is a flat budget key file (listed 2026-11-16; see [time, shards and phases](time-shards-and-phases.md#the-shard-files-in-this-repo)). Both shard files that set the key say `identity_mode: watched` (`shards/phase0.yaml` line 12, `shards/colo-mind.yaml` line 15).

## Conflicts recorded

1. **What "Watched" means.** Open, owner decision. Citations: [spec 5.14](../spec.md#514-shards-and-time); [spec section 2](../spec.md#2-principles), principle 7; decision [0059](../decisions/0059-identity-mode-is-about-human-observation-not-agent-belief.md).
2. **Principle 2 amendment.** The autonomy review records an amendment; no decision record exists; the spec is unchanged (see Principle 2 above).
3. **Permanent record versus erasure.** Spec principle 4 says "logged permanently". Decisions 0171 and 0262 erase an owner's lives' records on deletion; 0339 moved records out of live tables once. Migrations `sql/0039_account_deletion.sql` and `sql/0040_account_deletion_all_lives.sql` implement the erasure. The decisions are the owner's later word; the spec sentence is not amended by any record that names Principle 4.

## History

| When | What | Evidence |
|---|---|---|
| 2026-11-09 | Knowledge boundary; a ruling on `identity_mode` (what Watched means is open, owner decision) | [0058](../decisions/0058-the-character-knowledge-boundary-and-thought-v2.md), [0059](../decisions/0059-identity-mode-is-about-human-observation-not-agent-belief.md) |
| 2026-11-10 to 11 | Viewers and cameras read-only | [0072](../decisions/0072-glass-and-bluemap-are-public.md), [0075](../decisions/0075-glass-is-a-lakitu-camera.md) |
| 2026-11-11 | Bodies only in the Colo; no revive (Proposed) | [0151](../decisions/0151-bodies-run-only-in-the-colo.md), [0144](../decisions/0144-death-is-an-event-and-a-dated-fact-and-there-is-no-revive.md) |
| 2026-11-13 to 15 | Erasure rules | [0171](../decisions/0171-account-erasure-rule.md), [0262](../decisions/0262-account-deletion-erases-dead-lives-too.md) |
| 2026-11-14 | Owner rules "real stakes, no rescues" (review section E4) | `docs/analysis/autonomy/review-and-plan-2026-11-14.md` |
| 2026-11-15 | One-time world and memory exceptions | [world-operations exceptions](world-operations-exceptions.md), [0339](../decisions/0339-journal-reset-one-time-exception.md) |

## What it touches

[What is Geldar](what-is-geldar.md), [world-operations exceptions](world-operations-exceptions.md), [sovereign players](sovereign-players.md), [Body and Mind](body-and-mind.md), [life cycle of a life](life-cycle-of-a-life.md), and the planned [observation and privacy](observation-and-privacy.md), [economy and budgets](economy-and-budgets.md) and [time, shards and phases](time-shards-and-phases.md).

## Where to read the reference

- Decisions by spec section: [spec section map](../reference/spec-section-map.md), row "2 Principles".
- Terms such as Principle 1, Watched and Unwatched: [glossary](../reference/glossary.md).
- Shard toggles: [shard config](../reference/shard-config.md).
- Rules for anything an agent reads: [documentation style](../agents/documentation-style.md#agents-never-learn-they-are-watched).
