# 0329. On the NeoForge shard players and agents are equals; 0387 item 7 and 0059 do not apply there

> **Decision 0390 is Accepted (operator ruling, 2026-11-27, see 0289) and supersedes 0329.** The NeoForge twins stay frozen until their cards are re-dispatched; nothing is activated (held-live stands).

- Status: Superseded by 0390 (Accepted 2026-11-27) (was Proposed; operator rulings NF-1 to NF-6 of 2026-11-18, written up by the sheet campaign; questions Q1 and Q7 answered by the operator the same day; the operator accepts or edits this record)
- Date: 2026-11-18
- Spec: none edited. Section 2 (Principles 1 and 7), 5.8 (communication), 5.13 (Ghosts row), 5.14 (Watched row), 5.15.8 are read only; the Principle text is the operator's to edit (0073).
- Related: 0059, 0387 (item 7, and item 6 with 0385), 0322, 0375, 0383, 0385, 0388; [neoforge-delta.md](../analysis/sheet/neoforge-delta.md); [work-packets-sheet-neoforge.md](../analysis/harness/work-packets-sheet-neoforge.md); [neoforge-chat-plan.md](../analysis/sheet/neoforge-chat-plan.md)

## Context

The NeoForge shard is a distinct experiment from the autonomous (Paper) shard. On NeoForge humans play (0387 item 1, 0388). The sheet campaign's NeoForge twin cards were written under 0387 item 7 ("No observation of humans reaches agents. 0059 holds."): they blanked every human name and asked owner questions OD-NF-1 to OD-NF-6 about humans. The operator answered on 2026-11-18 with a principle and six rulings.

## Decision

**Scope (the operator principle).** On the NeoForge shard players and agents are equals, and agents are fully aware of players. 0387 item 7, and 0059 as far as 0387 item 7 relies on it, **do not apply to the NeoForge shard**. This is a statement of scope, not a change to the rule on Paper: on the autonomous (Paper) shard nothing changes, agents do not know humans exist, and no behaviour changes. 0059 and 0387 item 7 are not edited; this record is cited from them by path.

What "do not apply" means, and does not mean:

- It means no code, card or test on the NeoForge side may hide a player's presence, name or acts from an agent **because the player is human**. A human is an actor like any agent.
- It does not add any agent-facing text. No template, seed or tool text on either shard gains a sentence about humans or observers. Whether a NeoForge identity block should say that the world has human players, or that it is watched (the 0059 item 2 observer disclosure), is a template matter (a new version in `prompts/`) and an operator question (Q6 below), not decided here.
- It does not touch telemetry privacy (0375, 0387 item 8, the P3 export's anonymous human events). Those govern what leaves the server for the operator's data, not what agents perceive (Q5 below).

**The rulings (the operator's words, condensed).**

- **NF-1 (answers OD-NF-1). Human names are not blanked. An agent is told nothing it did not natively see through its own viewport.** When it witnesses a human doing something, the human's name is used as any actor's is. So no out-of-sight event reaches an agent on the NeoForge shard, from a twin card or any other path. What survives of the provenance feed under this rule is set out in the delta note section 3a. The provenance feed is skipped on NeoForge for v1 (Q1, answered 2026-11-18); the NATS widening `geldar.<s>.provenance.>` for the `neoforge` user (a 0383 amendment) is not written, and v2 would need it.
- **NF-2 (answers OD-NF-2). The attacker is named in every case, human or agent.** Amendment A5 (a human attacker is never named) is withdrawn for NeoForge. `observedActor` must name a visible human, who has no life id; the contract gains a name-keyed player actor (`PlayerActor { kind: 'player', name }`) beside today's life actor, and the Body gains a naming mode, both inert on Paper (delta note amendments A6 and A7, twin card AN-NF-25). "Every case" is read as "human or agent alike"; the attacker must still be visible (NF-1). The operator confirms this reading on acceptance.
- **NF-3 (answers OD-NF-3). Container-taking stays inactive on NeoForge.** Whether someone stole from the agent is for the agent to notice itself. Card AN-NF-51a is **Dropped** (not blocked).
- **NF-4 (answers OD-NF-4). Kill credit goes to the player who dealt the killing blow** (`LivingDeathEvent` source). Paper credits the last player to damage the mob within a window (`LivingEntity#getKiller`). The difference is accepted and recorded in AN-NF-47a and the delta note.
- **NF-5 (answers OD-NF-5). Proximity chat on NeoForge (NF-CHAT, spec 5.8) is planned** as its own prerequisite card set ([neoforge-chat-plan.md](../analysis/sheet/neoforge-chat-plan.md)). It belongs to the NeoForge campaign, which owns `neoforge/`. It narrows the `NoRegistryScanTest` chat ban, which needs its own record when the cards are dispatched. Until it merges and is switched on, HC-27b `spoke_first` and AN-49 stay inactive on NeoForge.
- **NF-6 (answers OD-NF-6). Human block owners are logged by name, like agent owners. No placeholder.** The P4 requirements in the delta note section 4 say so. `OwnerId` (`contract/schemas/block-owner.schema.json`, "The placer's agent or player id. Opaque", 1 to 64 characters) already takes a player name, so the contract does not change.

**Open (not ruled here).** OD-NF-8 (progression and proficiency) stays open. Q1 to Q7 below are new questions; Q1 and Q7 were answered by the operator on 2026-11-18 (marked there), Q2 to Q6 are still open.

## Places that rely on the old rule

Each is listed so the operator and later cards can check it. "Paper only" means it keeps working as written. "Neutral" means shard-neutral code that is still correct on NeoForge, because players are players there and no text needs the word "human". "Conflicts" means NeoForge needs a change or a ruling.

Decisions:

| Record | What it relies on | Status under this record |
|---|---|---|
| 0059 | Agents are never told humans watch; `identity_mode` says nothing to agents | Paper unchanged. Does not apply on NeoForge (scope above); no observer sentence is added (Q6) |
| 0387 item 7 | "No observation of humans reaches agents. 0059 holds." | Does not apply on NeoForge |
| 0387 item 6 | Humans earn nothing; cites "0385 items 3 and 4" | Stands for this version (Q7, answered 2026-11-18). The citation does not match 0385 as written: "humans earn nothing" is 0385 item 8; items 3 and 4 are "agents see only their own marks" and "a starter stipend" |
| 0385 items 3, 4, 8 | Own marks only, starter stipend, humans earn nothing (from `progression-defaults.md` Q2, Q5, Q9) | Item 8 stands for now (Q7, answered 2026-11-18, v1 scope only); items 3 and 4 are per-life rules, unaffected. 0385 is Proposed and progression is on hold |
| 0322, Consequences | "No human name leaves the NeoForge server in any sheet message" | Replaced for the twin cards by NF-1, NF-2 and NF-6. 0322 is Accepted and is not edited; its other items stand |
| 0058 | A character knows only what its in-world knowledge gives it | Stands on both shards; NF-1 is the same boundary applied to humans |
| 0068 | Prompt v4: no observer meta in agent-visible text | Stands (no template changes); its `MARKER_WORD` list is below |
| 0072 | Nothing public may be linkable from inside the world, because agents must not learn they are watched | Paper unchanged. On NeoForge humans can post any link in chat or on a sign; whether the rule still binds there is Q6 |
| 0075, 0100 | Glass and Lakitu: agents must not learn they are watched | Paper unchanged; on NeoForge part of Q6 |
| 0185 | The per-turn record is never in an agent's context (0059, 0068) | Stands: an operator record is not something an agent sees in the world |
| 0324 | Kit observation ids and positions, "under 0058 and 0059" | Stands for 0058; the 0059 part does not bind on NeoForge |
| 0361 | Agents are never told placement and public detail (0058, 0059, 0068) | Stands for 0058 and 0068; the 0059 part is Q6 on NeoForge |
| 0366 | Open: spec 5.14 Watched wording versus 0059 | Unchanged; still open |
| 0137 | Ghosts held in spectator and invisible to agents | Paper unchanged; on NeoForge already superseded for the human listener by 0387 item 3 |
| 0375 | Human chat export with a name mask | Telemetry privacy, not agent perception: unchanged (Q5) |
| 0383 | The `neoforge` user publishes `geldar.<s>.*` only | Unchanged. The provenance widening is not written (Q1: not needed for v1; v2 would need it); NF-CHAT's muffled notices would need a grant of their own (chat plan, NF-CHAT-3) |

Code and tests (shard-neutral unless stated):

| Place | What it does | Status |
|---|---|---|
| `contract/src/agent-text.ts` `MARKER_WORD` (`/observer|watch|human|maker|stream|credit|colo|shard|harness/i`) and `markedWords` | Keeps marker words out of agent-visible text our code writes | Neutral for our own text. **Conflicts** where it filters a player's name: AN-28a drops an actor name in which `markedWords` finds a word, and the regex matches inside a word, so a human named for example `Streamer` or `Colonel` would never be named. That breaks NF-2. Q2 |
| `contract/test/agent-text.test.ts`, `contract/test/agent-visible-text.test.ts`, `contract/test/wait-peek.test.ts`, `contract/test/outcome-detail.test.ts`, `contract/src/outcome-words.ts` | Leakage gates on outcome and input text | Neutral |
| `animus/src/prompts/agent-text.test.ts`, `animus/src/prompts/library.test.ts` (thought v4 and v5 keep observer, makers and credit wording out) | Template gates | Neutral; any NeoForge template change is a new version (Q6) |
| `prompts/README.md` (v4 removes observer wording) | Template history | Neutral |
| `threshold/mcp/src/neutral-text.test.ts`, `threshold/mcp/src/resources.test.ts` (lines that say humans are watching), `threshold/mcp/src/world.ts`, `threshold/mcp/src/world-session.ts` (keepalive names no observer), `threshold/mcp/src/tools/refusal-detail.ts` | MCP text gates | Neutral |
| `tools/mcp-tokens/src/persona-lint.ts` | Persona lint with `markedWords` | Neutral |
| `psyche/src/temperament.ts`, `golem/src/actions/use.ts` | Comments citing 0058, 0059, 0068 | Neutral |
| `plugin/core/.../GhostListener.java` | Ghosts cannot be heard by agents | Paper only |
| AN-24 `observationSentence` ("never reads an actor") and AN-28a, AN-28b leakage cases (no `ag_` id, no hidden actor) | Planned gates | Neutral; a `PlayerActor` carries no life id, so they still hold. AN-28a's marked-word name drop is Q2 |
| AN-25 `observedActor` (`{ name, life: lifeIdFor(username) }`) and amendment A5 | Names a visible attacker | **Conflicts**: `lifeIdFor` never fails (`golem/src/registry.ts:51` hashes any username into `ag_<stem><hash>_01`), so a human would get an invented life id, and A5 as written could never trigger. Fixed by A6, A7 and AN-NF-25; A5 withdrawn |
| `golem/src/perception/hurt-trigger.ts` `attackerNameOf` | The operator hurt log writes `player`, never a name | Neutral (an operator log, not agent text) |
| `neoforge/` P3 export (`EventEnvelope.isLifeId` in the mapping; `EventMappingTest`, `ExportHandlersTest`: no human name in any envelope; `neoforge/README.md` "Privacy") | Human events exported anonymously | Telemetry privacy, NeoForge campaign's code. Not changed here (Q5) |
| `neoforge/src/test/.../NoRegistryScanTest.java` `CHAT_WORDS` | No chat event in the mod | NF-CHAT narrows it (chat plan, NF-CHAT-0); needs its own record |
| `neoforge-ledger/` `NameMask`, `collector.chat.enabled=false` | 0375 telemetry | Unchanged (Q5) |
| The twin cards AN-NF-26a, 27a, 47a (`isLifeId` on every name) | Blanked human names | Rewritten for NF-1, NF-2, NF-6 (twin file) |

Spec (read only, not edited): section 2 Principle 1 ("No humans inside") and Principle 7 ("Two kinds of shard, never mixed"); 5.8 ("agents never see" the map's speech bubbles); 5.13 Ghosts row ("invisible to agents"); 5.14 Watched row; 5.15.8; 8.4. 0387's status line already says the spec and 0387 disagree for the NeoForge shard until the operator acts; the same holds for this record.

Docs that state the old rule and would need a sweep after acceptance (not edited here): `docs/security/agent-visibility-rules.md`, `docs/concepts/observation-and-privacy.md`, `docs/concepts/principles-in-practice.md`, `docs/concepts/sovereign-players.md`, `docs/analysis/neoforge/public-and-human-route.md`, `docs/analysis/neoforge/progression-defaults.md` (Q2 and Q9), `docs/analysis/neoforge/progression-design.md`, `neoforge/README.md` (Privacy).

## Questions for the operator (Q1 and Q7 answered 2026-11-18; Q2 to Q6 open)

- **Q1. Is the provenance feed needed on NeoForge at all?** **Answered 2026-11-18 (operator): skip it for v1; the Body derives observations itself; raise its priority for v2.** AN-NF-26a, AN-NF-27a and AN-NF-28b are **Deferred to v2 (0329 Q1: not needed for v1)**: kept in full, not dispatched in v1, revisited for v2. The 0383 widening stays unwritten; v2 would need it. What v1 loses on NeoForge (the `gave_me` and `took_mine` evidence) is in the delta note section 3b. The Body-derived cards (AN-NF-26b-native, AN-NF-27b-native, AN-NF-47c-native) are not written; their names stay reserved. The analysis as it was put to the operator: under NF-1 every surviving observation is one the Body can derive from its own perception, and the feed adds only a few cases (an instant break with no break-progress packet, which of several visible players tossed an item, a Body's block placed in an earlier session). It costs the 0383 widening, a Body subscription that receives every break and pickup on the shard, and NF-BODY grants. The sheet campaign proposed: not needed for v1.
- **Q2. Names that contain a marker word.** Should a visible player's name always reach the agent as the actor (it is what the agent sees on the player), or keep AN-28a's marked-word drop? NF-2 suggests the former on NeoForge. The same question applies to the snapshot's visible-agents list (UNVERIFIED whether it filters names).
- **Q3. Proximity chat for humans too.** Does spec 5.8 (no global chat, 32 blocks) apply to every listener on NeoForge, humans included (equals), and to commands that carry chat (`/msg`, `/tell`, `/me`, `/say`, `/teammsg`)? Chat plan section 5.
- **Q4. Server log of chat.** With proximity chat the mod cancels the vanilla chat event, which also drops vanilla's server log line. Keep a log line (human-written text in the server log, as vanilla does today) or not? Chat plan section 5.
- **Q5. Telemetry.** Does NF-6's "by name" extend to the P3 export events (today anonymous for humans), or does telemetry privacy stay as built (0375, 0387 item 8)? This record changes nothing there.
- **Q6. Observer disclosure on NeoForge.** 0059 not applying removes a ban; it adds no text. Should a NeoForge agent's identity block say that humans play there or that the world is watched (0059 item 2, `observer_disclosure`)? Does 0072's public-link rule still bind there?
- **Q7. Progression for humans (0385 items 3, 4 and 8; 0387 item 6).** **Answered 2026-11-18 (operator), for this version only: humans do not earn or hold marks in this version; agents still earn marks.** This is a v1 scope ruling, not a statement that humans never will. 0385 item 8 stands for now; items 3 and 4 are per-life rules and are unaffected. OD-NF-8 (how progression and sheet proficiency relate) stays open. 0387 item 6 still cites "0385 items 3 and 4" while the rule is item 8; the citation is left for the operator to correct. The analysis as it was put to the operator: progression is an encouragement mechanism: it rewards agents for engaging with mechanics and gives them the feedback humans get from playing. Seen that way, humans earning nothing fits: they already get that feedback. But marks are also an in-world medium (contracts, trade, post, accept and award in `progression-defaults.md` Q9), and a human who cannot hold or pay marks is not an equal trading partner. Item 3 (each agent sees only its own marks, no leaderboards) and item 4 (a starter stipend per life) are per-life rules and do not depend on humans either way. Do items 3, 4 and 8 still fit now that players and agents are equals?

## Why

The operator set the NeoForge shard up as its own experiment: humans and agents meet as players. Hiding humans from agents there would make that experiment impossible, and blanking a name the agent can see on the player would tell it less than its own eyes do. NF-1 keeps the boundary that matters on every shard: an agent learns only what it perceives.

## Consequences

- The twin cards are rewritten (twin file): AN-NF-27a and AN-NF-26a name every actor and are Deferred to v2 (Q1: not needed for v1); AN-NF-28b loses its NATS steps and is Deferred to v2 (Q1); AN-NF-47a keeps the combat facts only (lives only, because a fact is keyed by life id, not for privacy) with the NF-4 kill credit; AN-NF-51a is Dropped; AN-NF-50 no longer waits for AN-NF-28b; AN-NF-25 is new.
- Amendment A5 is withdrawn; A6 (contract) and A7 (golem) were proposed but are ON HOLD with this record pending the operator's revision (invisible-hand model): AN-24 and AN-25 do not carry them.
- The delta note's OD-NF-1 to OD-NF-6 are ruled by this record, pending its acceptance.
- On NeoForge in v1 the social model's `good` and `law` estimates of other agents and players get no evidence (Q1; delta note section 3b). Humans hold no marks in v1 (Q7).
- Paper: no card, code, test or text changes. Every NeoForge-only change is behind a default that keeps Paper byte-identical.
- Until the operator accepts this record, a reader who cites 0387 item 7 or 0059 for the NeoForge shard must also cite this record.
