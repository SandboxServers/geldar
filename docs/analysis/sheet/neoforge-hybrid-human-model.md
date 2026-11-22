---
title: Marker-name operator convention and named-equal humans: plan and filter cards
type: explanation
audience: operators
status: draft
last_verified: 2026-11-19 against 081cb6d1
companions: [../../decisions/0390-neoforge-hybrid-named-equals-and-nature-humans.md, ../../decisions/0329-neoforge-players-and-agents-are-equals.md, neoforge-delta.md, ../harness/work-packets-sheet-neoforge.md, neoforge-chat-plan.md]
---

# Marker-name operator convention and named-equal humans: plan and filter cards

Planning note, docs only, 2026-11-19, against `origin/main` = `081cb6d1`. It goes with decision 0390 (Proposed, supersedes 0329 once accepted). It builds nothing. Every NeoForge twin card (AN-NF-*) and every NF-F filter card is **FROZEN, not dispatched,** until the operator accepts 0390. Operator-facing; nothing here goes anywhere an agent reads.

Every sentence in quotes that an agent would read ("something ...") is a **PROPOSAL, not approved wording.**

## 1. The model (as the coordinator relayed it; the owner confirms by accepting 0390)

1. **Marker-named operator accounts are a deliberate convention.** When the owner or the operator must intervene by hand (unblock a robot, gather telemetry), the account used is named with a marker word. The existing guard (`MARKER_WORD` and `markedWords`, `contract/src/agent-text.ts`, exported at `contract/src/index.ts:10`, verified 2026-11-19) then classes that account as an act of nature to agents: no name, no alias, no theory-of-mind model, effects unattributed ("something ..."). This is a convention for operator accounts, not a class chosen by opt-in or detection among ordinary players.
2. **Paper:** robots only, fully autonomous. No ordinary human is connected; humans only watch. The one exception is a marker-named operator account used for a manual intervention. Principle 4 (spec section 2, "Everything is recorded", `docs/spec.md:108`) requires each intervention to be recorded and labelled for analysis: what, when, which operator account, in a place agents never see. The exact mechanism is OPEN (Q-d).
3. **NeoForge:** nobody uses a marker name by default. Ordinary humans are regular players in cohort with bots: named equals, proximity chat (owner's 2026-11-19 position, memory note "NeoForge human lane position"). A marker-named operator account is still nature there.
4. **Hand of god and serendipity stay deferred to v3** (`docs/ideas.md`, row "Hand of god and serendipity"; a deferral, not a prohibition). Its sentence "the invisible-hand and nudge wording in the NeoForge notes stays pending operator revision" is the operator's to update. 0390 does not make the marker-name convention a hand-of-god feature: it is operator maintenance, not an in-world gift to an agent.
5. **The classifier is blunt.** `MARKER_WORD` is `/observer|watch|human|maker|stream|credit|colo|shard|harness/i` and matches inside a word, so an ordinary `Colonel`, `Streamer` or `Colorado` would silently become nature on NeoForge. That is why Q-a (refuse such names for ordinary players) exists.

## 2. NF-1 to NF-6 under this model

Source: decision 0329 (unedited). For ordinary humans they stand largely as ruled. The only change is the marker-named exclusion.

| Ruling | Under 0390 |
|---|---|
| NF-1 names not blanked; an agent is told only what its own viewport showed | **Stands for ordinary humans.** A marker-named account is never named to an agent on either shard. No out-of-sight event reaches an agent. Provenance feed stays skipped for v1 (0329 Q1) |
| NF-2 attacker named in every case, `PlayerActor` (A6, A7, AN-NF-25) | **Stands for ordinary humans, narrowed:** a marker-named attacker is never named. Whether the name-keyed `PlayerActor` is built is OPEN (Q-e) |
| NF-3 container taking inactive, AN-NF-51a Dropped | **Stands** |
| NF-4 kill credit to the killing blow | **Stands.** Operator-side evidence, never agent-visible |
| NF-5 proximity chat (NF-CHAT) | **Stands** for ordinary humans: a real channel, names kept. A marker-named account's chat is Q-b |
| NF-6 human block owners logged by name | **Stands.** Marker-named operator accounts are also logged by name, because that is the Principle 4 record; the log is operator-side (`block-owner.schema.json`: "no text is agent-facing"). No placeholder constant is needed |

Also unchanged: humans earn no marks this version (0329 Q7, 0385 item 8); provenance feed skipped for v1 (0329 Q1); the old banners ("invisible hand, do not build") on 0329, the delta note, the sheet RESUME, the ledger and the NF twin file describe a model the operator has now replaced; the banners are to be rewritten on acceptance (section 6).

One narrow caution (UNVERIFIED, not checked at `081cb6d1`): where a block owner id could be shown to an agent (AN-27b `prior_owner`, deferred with provenance), a marker-named owner must not be named. v1 skips provenance, so nothing is exposed yet.

## 3. The one shared predicate

**Recommendation:** a new file `contract/src/marker-named.ts`, beside `agent-text.ts`, exporting exactly one function: `isMarkerNamed(name: unknown): boolean`, true when `name` is a string and `markedWords(name)` is non-empty (no `allowed` map, so it is exactly the guard). One new export line in `contract/src/index.ts` next to line 10. `@geldar/contract` is already a dependency of golem and the MCP (filter-plan facts, `golem/package.json:12`, `threshold/mcp/package.json:15`, not re-checked here), and the MCP cannot import golem, so contract is the one place both can reach. There is no life-id or registry predicate any more.

Rules: it reads the Minecraft **username** only, never a tab-list display name. A test pins names on both sides of the line (`Watcher`, `Colonel`, `Colorado`, `Streamer7` true; `Wanderer7`, `Steve` false).

**Verify before build (UNVERIFIED):** that every agent username (life-id stems, managed ids) passes the guard. An `ag_<stem>_NN` whose stem contains `watch`, `colo`, `credit` and so on would be hidden from other agents. The predicate's first test must run over the real stem list and managed-id shape. If one trips, that stem is a persona-naming bug to fix, not a reason to add a registry predicate.

## 4. Filter cards, card by card

The cards are in `docs/analysis/harness/work-packets-nf-body-filter.md` and `docs/analysis/sheet/nf-body-filter-notes.md`. **Both are on the unmerged branch `docs/nf-body-filter-plan` (commit `909eb4f1`), not on `origin/main` at `081cb6d1`,** so they are cited by name, not linked. The branch has nine rows (NF-F0, F6, F1, F2, F2w, F3, F4, F5a, F5b); all are covered. They assume the invisible-hand model and carry "do not dispatch"; they need rewriting under 0390 before any dispatch.

New shape: the suppression applies to marker-named players **on both shards**. No per-shard switch: on Paper it can only ever hide a marker-named account (plus any agent whose name wrongly trips the guard, see section 3), so Paper output for every other name is byte-identical. (Alternative if the operator wants Paper untouched until proven: keep a default-off switch; it costs the shard-file reader on both golem and MCP. OPEN, default no switch.)

Filter points verified at `081cb6d1`: `golem/src/perception/entities.ts:244` (`entity.type === 'player'` branch builds `agents[]`), `golem/src/perception/visible-agent.ts` (`otherPlayers` :37, `isUsernameVisible` :91, `findVisibleAgent` :112), `golem/src/perception/view/viewport.ts:211`, `golem/src/voice/ears.ts` (`playerChat` and `chat` listeners :74-75), `threshold/mcp/src/play-view/surroundings.ts:27`, `golem/src/actions/place.ts:81` and `golem/src/actions/give.ts:194-204` (person-words). Unverified at `081cb6d1` (from the filter plan at `6bf345c7`): `attack.ts` `findTarget`, `effect.ts` `targetsOf`, `golem/src/body-image/reader.ts` `entitiesInSight`, the MCP gateway files.

| Card | Verdict | What changes |
|---|---|---|
| NF-F0 shared predicate and four-copy pattern parity guard | **Merges into NF-F6; shrinks** | Replaced by `isMarkerNamed` (section 3). The LifeId and managed-id patterns, the parity guard across contract, golem, Java and schema, and OQ-9 are **dropped** |
| NF-F6 per-shard switch and `isHiddenPlayer` | **Shrinks, absorbs F0** | One card: predicate plus `isHiddenPlayer(entity)` = player entity and `isMarkerNamed(username)`. The `WeakMap` flag, the `body_perception.players` shard-file key and `parseAdamConfig` change are **dropped** (unless the switch alternative above is chosen) |
| NF-F1 snapshot `agents[]` and visible-player resolution | **Stays; fixtures flip** | Skip marker-named players in `observeEntities` and `otherPlayers`. Ordinary humans stay in `agents[]` and stay give, goto, follow targets |
| NF-F2 attack and effect targets | **Stays; fixtures flip** | Skip marker-named players in `findTarget` and `targetsOf`. Ordinary humans stay targets, as in vanilla between equals (Q-f) |
| NF-F2w person-words for a filtered cause | **Shrinks to wording; still BlockedDecision** | Only the unattributed case needs words. PROPOSAL: "something is standing there", "something picked the items up". The existing "someone ..." lines stay for ordinary unseen players |
| NF-F3 voice (ears, `heard`, speech events, `notifyAddressed`) | **Stays; shrinks** | Ears skip a marker-named speaker (default for Q-b). Ordinary humans' chat keeps its name and can wake a Mind as today; on NeoForge proximity needs NF-CHAT (`neoforge-chat-plan.md`), because `ears.ts` has no distance filter. Blocked on Q-b and NF-CHAT |
| NF-F4 text viewport and image reader | **Stays; fixtures flip** | Skip marker-named players in `viewFromBot` and `entitiesInSight`. Ordinary humans are drawn as today. No placeholder shape for the hidden one |
| NF-F5a MCP second line | **Shrinks** | Gateway drops `surroundings.agents` entries where `isMarkerNamed`. The MCP shard-file reader, `McpConfig` field and `main.ts` option are **dropped** (no switch) |
| NF-F5b leakage gate | **Stays; fixtures change** | Fixture: a marker-named account must appear in no agent-visible output; an ordinary named human must appear where the model says (positive control, so the scan cannot go quiet). Pending-channel test follows Q-b |

Summary: **merge 1 (F0 into F6); shrink 5 (F0 as merged, F6, F2w, F3, F5a); stay with changed fixtures 4 (F1, F2, F4, F5b); drop** F0's parity guard, F6's switch and config reader, F5a's config reader. Order after acceptance: F6 (predicate), then F1, F2, F4, F5a in parallel, then F5b. F2w and F3 wait for their answers.

Not covered by any card (carried from the filter notes): human-written signs, books and item names reach agents as untrusted world text; a marker-named account's sign could name its author; `bot.players` holds every online name in Body memory.

## 5. NF twin cards (AN-NF-*)

All stay **FROZEN**. With NF-1 to NF-6 largely restored, they revert to the 0329 rewrites: AN-NF-26a, 27a, 28b Deferred to v2; AN-NF-47a combat facts with NF-4; AN-NF-51a Dropped; AN-NF-50 unblocked from AN-NF-28b; AN-NF-25 (named `PlayerActor`) depends on Q-e. Any twin that names a human must refuse a marker-named name through the predicate.

## 6. Open questions for the operator (each with a proposed default)

- **Q-a. Should the NeoForge human lane refuse ordinary players whose chosen name contains a marker word?** Default: **yes.** Reserve marker-containing names for operator accounts, as 0387 item 5 already refuses agent-shaped names, so an ordinary `Colonel` or `Streamer` is never silently turned into nature. How an operator account passes is part of the answer (default: the owner holds a short list of operator account identities, by role, checked at login). Cost: a change to the human-lane proxy code (the NeoForge campaign's); blocks nothing in the filter cards. Without it, the blunt classifier stays.
- **Q-b. What does a marker-named account's chat do?** Default: **suppressed to agents entirely** (not delivered, no wake, no `speech` event to a Mind). Alternative: delivered unattributed (PROPOSAL "something said nearby"), which needs approved wording, a wake decision, and risks the words themselves naming an observer (0058, 0068). Operators who must tell an agent something use no chat; they act.
- **Q-c. How may marker-named operator accounts connect to Paper at all, and who may hold one?** Default: **only the owner and the operator hold one.** They connect through the existing human or spectator route with a UUID allow-list the owner manages (spec 8.4, decision 0137, whose spectator rule holds on Paper). Because a manual intervention needs the account to act, not only watch, it is an exception to Principle 1; 0390 does not grant it. The exception must be bounded and temporary, and the spec text is the operator's to edit (0073). Also open: the game mode of such an account, and the Velocity path.
- **Q-d. How is an intervention recorded?** Default: each marker-named account's session window (join and leave) and its in-world acts are labelled in the existing event stream, plus a short operator note (what and why), all in operator-only storage. UNVERIFIED: whether join and leave events are stored today; the NeoForge export is anonymous for humans (0375, 0387 item 8), so the labelling must be opted in for operator accounts only. The mechanism is OPEN.
- **Q-e. Is a name-keyed `PlayerActor` (theory-of-mind key) needed for ordinary named humans?** Default: **keep NF-2 as 0329 ruled** (attacker named; A6 contract change, A7 Body naming mode, AN-NF-25, 35k, inert on Paper), guarded so a marker-named name is never put in one. OPEN to confirm, because the banner had withdrawn A6. Alternative: **defer,** because provenance is already deferred to v2 (Q1) and hurt and death are nameless today; then no contract change, and the social model's `good` and `law` get no human evidence in v1. Cost of keeping it: a schema change and regeneration, names that persist in stored observations (privacy 0375, erasure 0323), and Microsoft names change so a name is not a stable key.
- **Q-f. Confirm:** agents can attack ordinary named humans (equals, as in vanilla). 0390 adds no rule.
- **Q-g. Switch or no switch** for Paper (section 4). Default: no switch.
- Carried unchanged from 0329: Q3, Q4, Q5, Q6, OD-NF-8. 0329 Q2 (names that hold a marker word) is answered by this model plus Q-a.

Docs sweep after acceptance (not done here): the 0329 list (`docs/security/agent-visibility-rules.md`, `docs/concepts/observation-and-privacy.md`, `docs/concepts/principles-in-practice.md`, `docs/concepts/sovereign-players.md`, `docs/analysis/neoforge/public-and-human-route.md`, `neoforge/README.md`), the pending-revision banners and ledger rows, and the `docs/ideas.md` row.

## 7. What this note did not check

No code was run. "Verified" means a file read at `081cb6d1`. The guard's behaviour on real usernames is read from the regex, not executed. Whether NeoForge sends human player entities to a mineflayer Body is unverified (filter notes, unverified item 1).
