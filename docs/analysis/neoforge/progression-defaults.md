# NeoForge progression: default choices

Date 2026-11-17. Branch phase1/nf-progression-defaults. Docs only. Source: [progression-design.md](progression-design.md) (2026-11-16).

**Defaults chosen under the owner's delegation of 2026-11-17 ("Make reasonable default choices for the progression system."). Revisable. Nothing here is in force until the flagged decision record exists. The lead assigns its number; this note assigns none.**

## Counting note

Section 13 of progression-design.md lists nine numbered open questions (section 1 repeats the first). The brief's count of ten is not in the text, so this table covers the nine. The six blocking policy decisions (named in RESUME.md and in the brief) are the groups B1 to B6 below. Together they cover all nine rows, so no row is outside the blocking set. Flag for the lead.

`docs/spec.md` is not edited (owner-only, see the decision titled "Spec is never edited" under docs/decisions/0073-spec-is-never-edited.md).

## Defaults

Blocking group: B1 scope, B2 proficiency overlap, B3 what agents see, B4 marks and stipend, B5 claims, waypoints and recipe holds, B6 humans.

| Question (group) | Default chosen | Why | How to change it later | Risk if wrong |
|---|---|---|---|---|
| Q1 Principle 2 "no quests, no scoring" versus a points system (B1) | In scope only as a per-shard research variable. `progression.enabled` is OFF by default and ON only in the NeoForge scratch shard config. The relaxation of Principle 2 is recorded in a new decision record. The spec is untouched. The existing autonomous shard has no key, so it stays off and is untouched. | Spec section 2 Principle 3: every constraint is documented and toggleable per shard. Principle 2: nothing is a goal, and the mod adds capability unlocks only. No text tells an agent to pursue points. | Owner accepts, amends or rejects the decision record. Flip or delete the shard key; the flag and its code can be removed together. | The relaxation spreads to other shards, or agents treat points as goals (Goodhart). Mitigated by the flag, the caps and the absence of points text. |
| Q3 Overlap with proficiency-state (B2) | `proficiency-state` is the only skill and XP signal. Progression keeps no second skill meter. Its award engine writes XP into the seven existing domains, and unlocks read the domain levels 0 to 3. Progression adds unlocks, claims, waypoints and contracts on top. Professions map to domains: forager to farming, miner to mining, builder to building, smith and cook to crafting, courier to exploring, merchant and scribe to social. Combat is never awarded. | The proficiency record (docs/decisions/0280-proficiency-contract-and-state-subjects.md) fixes seven domains, levels 0 to 3, and version as total XP. Two meters would give agents two contradictory skill numbers. | Owner rules a different mapping, or a second meter. The mapping lives in the P6 config. | The writer (AN-04a) changes the meaning of xp. The design's 0 to 2600 point table does not match the 0 to 3 domain scale, so the unlock thresholds are re-derived. A bad mapping misreads play. |
| Q2 What agents see: numbers, limits, leaderboards (B3) | Agents see plain MCP tool text only, through existing tools. Shown: their own marks balance and escrow, and their own unlocked capabilities (claim size, waypoint slots, contract slots). The mechanics sentence and the daily cap appear as a world rule. Not shown: total points, points counted today, the next-unlock gap, other agents' numbers, leaderboards, progress bars. The wording says "marks", never "credit", and never says they are measured or watched. | Principle 2 and section 2: a visible score is a goal. Decision titled "identity_mode governs whether humans may observe a shard; the agents are never told" (docs/decisions/0059-identity-mode-is-about-human-observation-not-agent-belief.md) and the prompt-v4 decision (docs/decisions/0068-prompt-v4-and-agent-visible-text.md, still Proposed) forbid observer meta. `MARKER_WORD` in contract/src/agent-text.ts lists "credit", "watch", "human", "shard", "observer", "stream", "harness", "colo", "maker". Telemetry isolation: design section 2 rule 4. Deviation from design section 8.2: the total-points and daily-count lines are dropped. | Owner adds lines by a change to the provider and its golden fixture. The lint test runs in CI. | Agents who cannot see their score may find the cap or contract slots puzzling. Showing the numbers invites gaming. |
| Q4 Marks ledger: internal, or the world credit ledger (B4) | An internal server-side ledger in the mod's own saved data. It is not the thinking-budget ledger of spec section 5.7 (Metabolism, Thinking Budget). Marks cannot pay for thinking. | Spec 5.7 is the thinking budget. Reusing it would let marks inflate thinking credits, and "credit" is a marker word. Per-agent audit rows go to events only, with no agent-visible text. | Owner rules a link to the world ledger. That needs a round trip and an inflation policy. | Marks become a shadow currency between agents. Balances are lost if the saved data is outside the world backup (design section 6.1 says it is inside). |
| Q5 Stipend and marks sources (B4) | A small fixed starter stipend, once per life (placeholder 10 marks). After that, marks come only from counted novelty and usefulness, after decay and caps. No per-level stipend. A hard daily mark cap per agent (placeholder 40). No marks for anything that bypasses survival, and no purchase of marks for items, time or money. The holding cap of 10 times the starter stipend stays. | Principle 1: humans earn nothing. Principle 2: nothing is a goal. A per-level stipend would pay for levels. Without a starter, nobody can post a first contract. Tying marks to counted work keeps them to work done in the world. | Owner sets the amounts. They are constants in the P6 config, with golden tests. | A starter too small to start contracts, or too large for the sweep. If loops can earn marks, the pair rules of design section 3.6 apply. |
| Q6 Waypoints: names only, or fast travel (B5) | Names only. A waypoint is a recorded place that the agent walks to by name, as a `goto` target. Caps are small: 1 at level 1, up to 3 in v1. No teleport. | The owner ruled out speed. The design (section 4.1) excludes teleport as a speed capability. Small caps keep waypoints a memory aid. | Owner rules teleport separately. A new verb needs a contract change. | Low risk. A teleport would be a speed capability and must not ship without a ruling. |
| Q7 Claims: protection, or marker only (B5) | v1 ships claims as a marker only, with small caps: edge 16 at level 1, rising to 32 at level 3. A claim is created automatically around the set bed. No break cancellation and no protection in v1. | Principle 5: emergent misbehaviour is data and we don't patch it. Protection changes that stance. Protection also needs the block-owner log (P4), which is on hold in RESUME.md. | Owner rules on protection. Then P4 lands and a break-cancel listener is added. | Griefing is not stopped in v1. The marker still shows other agents where a claim is, which may draw conflict. |
| Q8 Recipe holds through limitedCrafting and hidden advancements (B5) | No held recipes in v1. In v2 only, behind a second flag `progression.recipe_holds`, OFF by default, and only for utility sets W1 to W3. No weapon, armour or tool tiers. A held recipe fails as today (`not_possible`, `detail.unlocked: false`), and no text lists its name. | The decision titled "Recipe discovery is part of the game; the plugin stops granting the recipe book" (docs/decisions/0048-recipe-discovery-is-part-of-the-game.md) says recipes stay discovered. NeoForge 26.1: no cancellable craft event (docs/analysis/neoforge/neoforge-api-notes.md, section 4). The datapack override path is UNVERIFIED. A hidden advancement still syncs packets to vanilla clients. | Owner decides v2 and the second flag. The bench confirms the override path on 26.1. | The override is fragile, or costs ticks. A held recipe looks odd (design section 13). A vanilla client may show a tab. |
| Q9 Humans (B6) | Humans earn nothing, hold no marks, cannot trade, post, accept or award. Only UUIDs that resolve to a registered agent life have records. The admin surface is read-only, plus one kill switch that stops awards for everyone. | Spec section 2 Principle 1: humans never give items or intervene. Design section 2 rule 5 (the `isAgent` predicate). Spectators are invisible to agents (spec 5.13, Ghosts). | Owner confirms the bench human is a non-agent (design section 13, question 9). | A bench test that needs marks must use a fixture, not the live award path. |

The brief expects four questions outside the blocking set. The text has none outside B1 to B6, so Q4 to Q8 are chosen conservatively inside their groups, and each row says what would change.

## Packet order

The brief's P6 to P8 do not match the packet numbers in design section 12 (where packets 1 to 9 differ). This section uses the brief's numbers. Design packet 1 (the pure XP library) must land first.

- **P6, skeleton.** Gradle module `neoforge/progression`, the saved-data container, and the `progression.enabled` flag, default false. Needs from P3: nothing to start. The NATS emitter that uses the P3 publisher is a later step. Needs from the MCP and contract side: nothing. Paths: `neoforge/` only. Schema change: none. Flag: none, unless the shard key goes in a `shards/` yaml, and that file is read by the colo stack, so check before merge.
- **P7, MCP text.** `ProgressionTextProvider` and its golden fixture in `neoforge/` (not flagged). Needs from P3: the reply publisher for `state.<life_id>.progress`, through the P3 adapter. Without it there is no reply path. Needs from the MCP and contract side: the `progression` object in the snapshot schema, the state-subject builders, and the extended banned-word scan. Flags: `threshold/` (the MCP renderer), `contract/` (schema and `subjects.ts`), and `golem/` if the self section is assembled there. Schema change: yes, so it goes through the lead's coder.
- **P8, contracts.** `ContractEngine`, `Escrow` and `DeliveryDetector` in `neoforge/` (not flagged). Needs from P3: the export of `contract_event` on the NATS publisher. Needs P4 for container delivery; without it, delivery counts only when the poster is in the area. Needs from the MCP and contract side: the `contracts` read tool, the `act` verb `contract` (post, accept, cancel, dispute), the `mcp-world.schema.json` entries, and the reply subject. Flags: `threshold/`, `contract/`, and `sql/` if contract events are stored in Postgres (`sql/` auto-deploys). `eventsink/` should be unchanged, because the sink filter ignores five-token subjects; confirm before merge. Schema change: yes, so it goes through the lead's coder.
- **Admin surface (design packet 7).** Stays in the mod (`neoforge/`). Touches `tools/admin/` only if a console wrapper is added. Default: not added.

Packets that touch `golem/`, `eventsink/`, `tools/admin/`, `contract/`, `sql/` or `threshold/`: P7 and P8. P6 touches none by default. Packets with a schema change (P7, P8) go through the lead's coder.

## What stays an owner decision

1. The Principle 2 relaxation. Whether a decision record is enough, or the spec needs a line (only the owner edits the spec). Also decide the open watched-wording question (docs/decisions/0366-open-spec-5-14-watched-wording-versus-0059.md). Progression text must work under either wording.
2. Any real-money or external value. Marks never leave the shard. Any sale, exchange for money, or cross-shard value is the owner's call.
3. Anything visible to humans: BlueMap, the Thought Stream, Grafana panels that show marks, points, contracts or claims, and what Ghost spectators see.
4. Claim protection (Principle 5 stance), and any teleport.
5. Held recipes in v2: the second flag and which recipes.
6. The numbers. Every constant is PLACEHOLDER until the simulation sweep. The gate is the design's target: honest play beats the best loop by at least 3 to 1.
7. Whether progression runs on any shard other than the NeoForge scratch shard.
8. Whether the bench human is a non-agent (Q9).
9. Whether the progress audit (numbers only) is captured to SigNoz under the 2026-11-15 telemetry ruling (docs/decisions/0350-telemetry-scope-and-full-capture.md), including for outside players.

## Revisit when

- The first sweep shows the best loop beats honest play by less than 3 to 1 (design section 11).
- A golden or lint test finds a marker word in progression text.
- The Principle 2 record is accepted or rejected, or the open watched-wording record is resolved.
- The P0 join result is negative: no golem Body joins the NeoForge shard, so progression has no test subject.
- The NeoForge 26.1 recipe-override path is verified or rejected (neoforge-api-notes.md, section 4, marked UNVERIFIED).
- The proficiency-state writer changes what xp or the domains mean.
- A second shard asks for the flag.
- An audit flag fires: cohort outlier above 3, or reciprocity above 0.6 over a week.
- P4 (block-owner log) lands, so claim protection and container delivery become possible.

## Sources read

- docs/analysis/neoforge/progression-design.md (full), RESUME.md, neoforge-api-notes.md (section 4).
- docs/spec.md: section 2 (Principles 1, 2, 3), section 5.7, section 5.13, section 5.14. Read only.
- docs/decisions (by path): recipe discovery (0048 file), identity_mode and agents never told (0059 file), prompt v4 (0068 file, Proposed), spec never edited (0073 file), metrics exporters (0088 file), per-turn record (0185 file), proficiency contract (0280 file), telemetry scope (0350 file), watched wording (0366 file).
- contract/src/agent-text.ts (MARKER_WORD).

Gap: no accepted decision says "telemetry never reaches an agent" in those words. The closest are 0185 (operator-only records) and 0068 rule 1. The design's section 2 rule 4 is the working rule here.
