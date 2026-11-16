---
title: Superseded and reversed decisions
type: explanation
audience: contributors
status: draft
last_verified: 2026-11-16 against dc07e3fa
companions: [README.md, decision-timeline.md, ../decisions/README.md, ../reference/decisions-by-topic.md, ../concepts/world-operations-exceptions.md, ../concepts/economy-and-budgets.md, ../runbooks/world-and-memory-reset.md]
sources: [docs/decisions, docs/decisions/README.md, docs/analysis/docs-library/plan.md, CLAUDE.md, compose/colo.yml, shards/colo-mind.yaml, shards/phase0.yaml, animus/src/prompts/library.ts, golem/src/body/reflexes/hazard-escape.ts, threshold/register/src/providers.ts, threshold/register/src/identity.ts, threshold/mcp/src/tools/act.ts, threshold/mcp/README.md, plugin/core/src/main/java/dev/geldar/core/RecipeGrantListener.java, plugin/core/src/main/java/dev/geldar/core/speech/ChatFeedWriter.java, plugin/core/src/main/java/dev/geldar/core/skins/AgentSkinProvider.java, sql/0040_account_deletion_all_lives.sql, sql/0051_character_audit.sql, sql/0052_character_erase_comments.sql, tools/mcp-tokens/src/players.ts, .github/workflows/ci.yml, package.json, deploy/colo-admin.sh]
---

# Superseded and reversed decisions

Which decision records a later record superseded, amended, limited or reversed; which are temporary, one-time or provisional; which are still Proposed; and how each chain shows in the code today, where that was cheap to check. It explains why the record you are reading may not be the whole story. For every record in date order, see the [decision timeline](decision-timeline.md).

A record is never rewritten to say something else; a later record supersedes it ([decisions README](../decisions/README.md) line 5). So the current rule on a subject is often spread over two or three records. This page names those sets.

Everything here was checked on 2026-11-16 at commit db33805c and re-checked at `dc07e3fa`, which changes only `docs/security/`. A "code today" cell says what a cheap read of the named file shows. It is not a behaviour test, and nothing on the node was checked (plan decision D8). Observation and telemetry records are named at the level of their index titles and decision 0350 only (decision [0361](../decisions/0361-agents-never-placement-and-public-detail.md)).

## Status vocabulary

The record template allows two statuses: `Accepted | Superseded by NNNN` ([decisions README](../decisions/README.md) line 10). The records use more.

Measured with this command (PowerShell 7, repo root). It reads the first `Status:` in each record, list form or bare, and keeps the text before the first `(`, `.`, `;`, `,` or a space and digit:

```powershell
$st = foreach ($f in git ls-files docs/decisions | Where-Object { $_ -match '/\d{4}-' }) {
  $m = Select-String -Path $f -Pattern '(^|\s)-?\s*\**Status\**:\**\s*(.*)$' -List
  if ($m) { $m.Matches[0].Groups[2].Value } else { '(none)' }
}
"records: $($st.Count); distinct full Status lines: $(($st | Sort-Object -Unique).Count)"
$st | ForEach-Object { ($_ -split '[(.;,]|\s\d')[0].Trim() } |
  Group-Object -CaseSensitive | Sort-Object Count -Descending |
  ForEach-Object { "{0,3}  {1}" -f $_.Count, $_.Name }
```

Result: 187 records, 109 distinct full Status lines, and these leading wordings.

| Leading wording (case as written) | Records | In the template? |
|---|---|---|
| Accepted | 97 | Yes |
| Proposed | 46 | No |
| Decided | 26 | No |
| accepted (lower case) | 6 | Case differs |
| Accepted provisionally | 6 | No |
| Open | 2 | No |
| Superseded by | 2 | Yes |
| accepted in part | 1 | No |
| Accepted in principle | 1 | No |

The split hides three more wordings: "accepted, temporary" (0149) counts under accepted, and "Accepted, chosen option B" (0352) and "Accepted (one-time ...)" (0339) count under Accepted.

Records that lead with a wording the template does not list: 187 total, minus 97 Accepted, minus 2 Superseded by, gives **88**. The six lower-case "accepted" records are among the 88.

**Index against records.** The index Status column has the same leading words for all 187 records, ignoring case (a per-number comparison script run on 2026-11-16; the six lower-case records show as Accepted in the index). The index often says more than the record's own Status line; see [headers that do not name a later change](#headers-that-do-not-name-a-later-change).

**Format drift.**

- 18 records write `Status:` as a bare line, not the template's `- Status:` (0088, 0095, 0100, 0101, 0133, 0134, 0136, 0138, 0139, 0140, 0147, 0148, 0149, 0191, 0214, 0250, 0350, 0351).
- 16 have no `Date:` line at the start of a line ([decision timeline](decision-timeline.md#records-with-no-date-line)).
- [0135](../decisions/0135-self-registration-with-github-and-discord.md) has its title, Status, Date and most of its body run together on the first line: 7 line feeds in 8,191 bytes.

**Against the plan's figure.** Plan finding F-5 ([plan](../analysis/docs-library/plan.md) section 3) counted 40 index rows and 35 record files starting with "Proposed" at cd4499da. Today both are 46. Records 0360 to 0365 (six, all Proposed) account for the index change. The record-file gap of five is the bare `Status:` lines of 0088, 0095, 0100, 0101 and 0351, which a list-form pattern misses: at cd4499da, 35 record files have `- Status: Proposed` and these five have a bare `Status: Proposed` (`git show cd4499da:<file>` for each record, 2026-11-16). The plan does not give its command, so that it used a list-form pattern is inferred.

## Fully superseded

Two records carry `Superseded by` as their status.

| Record | Superseded by | What replaced it | Code today |
|---|---|---|---|
| [0053](../decisions/0053-public-mcp-through-an-outbound-tunnel-deferred.md) The sovereign MCP is loopback-only for now | [0071](../decisions/0071-public-endpoints-and-ports.md), 2026-11-10 | Public endpoints and ports on the Colo; [0090](../decisions/0090-public-mcp-contract.md) item 4 restates the supersession | Not checked |
| [0141](../decisions/0141-soft-dig-pathing-for-natural-soft-blocks.md) Pathing may dig natural soft blocks | [0164](../decisions/0164-goto-digs-and-builds-its-way.md), 2026-11-13 | `goto` digs and builds its own way, never through protected work | Not checked |

## Chains: amended, superseded in part, extended or reversed

Each row reads left to right: the earlier record, the later record that changed it (the later record's own words, cited), and what the code shows. "Header" says whether the earlier record's own Status or header lines name the change.

### Body

| Earlier | Later | What changed | Header | Code today |
|---|---|---|---|---|
| [0031](../decisions/0031-place-at-feet.md) | [0160](../decisions/0160-place-at-feet-pillar-step.md) | A solid block at feet is a pillar step; 0160 "Supersedes: the solid-block part of 0031" | Yes ("Superseded in part by 0160") | Not checked |
| [0063](../decisions/0063-phase-0-has-no-stuck-signal.md) | [0142](../decisions/0142-stall-and-replan-numbers.md) (Proposed) | 0142 "amends the stall numbers behind decision 0063" | No | `golem/src/actions/pathing.ts` line 445 cites 0142 |
| [0141](../decisions/0141-soft-dig-pathing-for-natural-soft-blocks.md) then [0164](../decisions/0164-goto-digs-and-builds-its-way.md) | [0219](../decisions/0219-decayed-farmland-is-not-ownership.md) | 0219 "Amends: 0164 (the `till` ownership refusal only)"; [0183](../decisions/0183-unstick-safe-drops-and-hand-dig.md) and [0210](../decisions/0210-unstick-call-budget-and-goto-escalation.md) keep 0164's ownership rule | No (0164) | Not checked |
| [0168](../decisions/0168-rotten-flesh-only-when-starving.md) | [0182](../decisions/0182-eat-reflex-only-when-starving.md), [0216](../decisions/0216-eat-choice.md) (Proposed) | 0182 amends the eat reflex's firing rule; 0216 amends the food choice in `golem/src/actions/eat.ts`; 0168 itself amends `BANNED_FOODS` | n/a | `golem/src/actions/eat-choice.ts` cites 0216 |
| [0194](../decisions/0194-swimming.md) | [0337](../decisions/0337-drowning-mover-steers-sideways-when-pinned.md) | The drowning reflex starts at air 12, not 8 | Yes ("amended by 0337") | `golem/src/body/reflexes/hazard-escape.ts` line 14: `DROWNING_START_AIR = 12`. Agrees with 0337 |
| [0196](../decisions/0196-idle-stuck-reflex.md) | [0330](../decisions/0330-boxed-in-on-own-blocks-unsticks-after-120s.md) | 0330 "Amends: 0196 (idle_stuck B1, the clause that skips a Body standing on its own placement)" | No | Not checked |
| [0224](../decisions/0224-sleep-failure-detail.md) (Proposed) | [0225](../decisions/0225-rest-stat-and-bed-refusals.md), [0226](../decisions/0226-bed-census-in-sleep-failure.md) (both Proposed) | 0225 amends the sleep refusal text; 0226 amends the tried-beds failure text of 0224 | No | `golem/src/actions/sleep-outcome.ts`, `sleep-refusal.ts` and `sleep-census.ts` cite them: all three Proposed records are in code |
| [0145](../decisions/0145-agent-names-need-line-of-sight-and-proximity.md) | [0334](../decisions/0334-name-tolerance-among-visible-agents.md) | Clarifies 0145, "which is not changed" (index title of 0334) | n/a | Not checked |

### Mind and prompts

| Earlier | Later | What changed | Header | Code today |
|---|---|---|---|---|
| [0002](../decisions/0002-phase0-host-and-models.md) | [0050](../decisions/0050-phase0-mind-processes-run-on-the-host.md) | 0050 "amends the consequence line of decision 0002" | No | Not checked |
| [0050](../decisions/0050-phase0-mind-processes-run-on-the-host.md) | [0078](../decisions/0078-mind-placement-for-phase1.md) | 0078: "Decision 0050 stays true for Phase 0. This record supersedes it for Phase 1 only when the owner accepts it." 0078 is Accepted (owner confirmed 2026-11-10) | No | `compose/colo.yml` line 283 keeps `animus` under profile `mind` ([0134](../decisions/0134-mind-is-a-profile-until-a-thinker-exists.md)), so the Phase 1 Mind is defined but not started by default |
| [0051](../decisions/0051-adam-identity-and-model-pins.md) | [0181](../decisions/0181-thought-context-8704.md) | 0181 "Amends: the `num_ctx` value 8192 in decision 0051" | No | `animus/src/prompts/library.ts` line 42 `CONTEXT_TOKENS = 8704`; `shards/colo-mind.yaml` lines 152 and 157 `num_ctx: 8704`. Agrees with 0181 |
| [0068](../decisions/0068-prompt-v4-and-agent-visible-text.md) (Proposed) | [0074](../decisions/0074-shelter-means-an-enclosed-safe-space.md) | 0074 makes prompt v5 and body-api v2 the defaults (index title) | n/a | `animus/src/prompts/library.ts` lines 132 to 138: thought v5, body-api v10, reflection v2 are the defaults; v1 to v4 stay in `prompts/thought/`. The 0068 rule that released templates are immutable is practised and repeated in `CLAUDE.md`, though 0068 is still Proposed |

### World, map and skins

| Earlier | Later | What changed | Header | Code today |
|---|---|---|---|---|
| [0032](../decisions/0032-table-crafting-and-recipe-book.md) | [0048](../decisions/0048-recipe-discovery-is-part-of-the-game.md) | 0048 "supersedes item 2 of decision 0032 and its follow-up on the join-time grant" | No (the body of 0032 says it) | `RecipeGrantListener.java` header: "Off by default since decision 0048". Agrees with 0048 |
| [0140](../decisions/0140-agent-skins.md) | [0172](../decisions/0172-human-skin-upload-held-for-approval.md), [0250](../decisions/0250-skin-upload-visibility-and-export.md) | Both extend 0140; 0172: "0140 is extended, not superseded" | No | Not checked |
| [0140](../decisions/0140-agent-skins.md) | [0187](../decisions/0187-bluemap-skin-provider-in-geldar-core.md) (Proposed) | 0187: "This reverses the line of 0140 that nothing new goes into Paper or geldar-core, for this one case" | No | `plugin/core/.../skins/AgentSkinProvider.java` is a BlueMap skin provider, though 0187 is Proposed and no file outside `docs/` cites 0187 |
| [0197](../decisions/0197-speech-bubbles-on-the-map.md) (Proposed) | [0310](../decisions/0310-live-chat-panel-on-the-map.md) | 0310: "Decision 0197 ... is superseded in part: its feature ... is removed" | No; 0197's status is still plain Proposed | `ChatFeedWriter.java` line 35 names the old marker set as `OLD_MARKER_SET` (inferred: kept to remove it) |

### Identity, sign-up and erasure

| Earlier | Later | What changed | Header | Code today |
|---|---|---|---|---|
| [0070](../decisions/0070-phase1-is-the-colo-first-shard.md) | [0135](../decisions/0135-self-registration-with-github-and-discord.md), then [0261](../decisions/0261-open-signup-player-host-bodies-and-auto-roster.md) | 0135: "0070's 'invite-only' becomes 'verified sign-up, unannounced'... this record amends it". 0261: open sign-up for everyone, "0070 and 0135 wording reconciled" (index title) | No | Not checked |
| [0135](../decisions/0135-self-registration-with-github-and-discord.md) | Its own amendment of 2026-11-11 (rulings R40 to R42) | "This amendment supersedes the parts of the decision above that name GitHub, Discord, account age and a daily cap": sign-in is Microsoft only | The title and file name still say GitHub and Discord | `threshold/register/src/providers.ts` line 24: Microsoft authority only. `identity.ts` line 4 still lists `'github' \| 'discord'` in the `ProviderName` type (residue, not behaviour) |
| [0077](../decisions/0077-invitee-auth-and-the-0072-0075-login-rule.md) | [0135](../decisions/0135-self-registration-with-github-and-discord.md) | 0135: owner-minted invitee tokens "stay available" | n/a | Not checked |
| [0152](../decisions/0152-programmatic-body-management-for-owners.md) | [0260](../decisions/0260-body-container-control-by-host-helper.md) | 0260: "Item 3 of 0152 is superseded in one part" (the supervisor no longer holds the Docker socket) | No | Not checked |
| [0153](../decisions/0153-terms-consent-and-deletion-before-sign-up.md) | [0155](../decisions/0155-legal-text-v1-approved-and-contact-published.md) | 0155 "amends the draft status in 0153, which stays as the record of the drafting rule" | No | Not checked |
| [0171](../decisions/0171-account-erasure-rule.md) | [0262](../decisions/0262-account-deletion-erases-dead-lives-too.md), [0282](../decisions/0282-sheet-erasure-covers-dead-lives.md) | 0262 "Supersedes: 0171 point 2 only": dead lives are erased too; 0282 does the same for the sheet tables | Yes for 0262 ("Point 2 superseded by 0262"); 0282 not named | `sql/0040_account_deletion_all_lives.sql` (0262). `sql/0051_character_audit.sql` table comments still say dead lives stay (0171); `sql/0052_character_erase_comments.sql` replaces those comments. Line 10 of 0051, a SQL comment, still repeats the old rule |

### Infrastructure, ingress and data

| Earlier | Later | What changed | Header | Code today |
|---|---|---|---|---|
| [0057](../decisions/0057-sovereign-budget-numbers-and-wake-spacing.md) | [0149](../decisions/0149-act-budget-suspended-and-metered.md) | The act budget and the per-life act rate limit are not enforced by default; every act is metered | No | `compose/colo.yml` line 356 and `threshold/mcp/src/tools/act.ts` line 67: suspended unless `GELDAR_ACT_BUDGET_ENFORCE=1`. See [economy and budgets](../concepts/economy-and-budgets.md) |
| [0067](../decisions/0067-nats-accounts-and-least-privilege.md) | [0080](../decisions/0080-nats-auth-cutover.md) | 0067 is opt-in; 0080 builds on it ("0067 adds NATS accounts and least-privilege users") and sets the cutover | No | Not checked |
| [0076](../decisions/0076-backup-scope-and-destination.md) | [0130](../decisions/0130-phase1-owner-rulings-for-c1.md) | Backups deferred (0130 index title; the index row of 0076 says "destination and backup build deferred (0130)") | No | Not checked |
| [0085](../decisions/0085-append-only-audit-tables.md) | [0339](../decisions/0339-journal-reset-one-time-exception.md) | One exception: a one-transaction trigger bypass for a one-time reset | No | See [temporary and one-time](#temporary-one-time-and-provisional) |
| [0087](../decisions/0087-nats-overlay-live-test-and-scoped-subjects.md) (Proposed) | [0137](../decisions/0137-public-spectator-proxy-is-separate-and-online.md) item 3 | 0087's own amendment: "The velocity row above is superseded: velocity is read-only" | Yes (in the body) | Not checked |
| [0092](../decisions/0092-velocity-spectator-whitelist.md) (Proposed) | [0137](../decisions/0137-public-spectator-proxy-is-separate-and-online.md) | 0092: "Decision 0137 supersedes the signal as the primary path" | Yes (in the body) | Not checked |
| [0088](../decisions/0088-metrics-exporters-and-replay-window.md) (Proposed) | [0350](../decisions/0350-telemetry-scope-and-full-capture.md) | 0350 amends 0088 (0350 index title). An amended record that was never accepted | No | Not checked |
| [0350](../decisions/0350-telemetry-scope-and-full-capture.md) | [0352](../decisions/0352-telemetry-dedicated-clickhouse-database.md) | 0352 amends 0350 items 4 to 6 (0352 index title). 0350's status is still plain Accepted (plan finding F-5) | No | Not checked (node state, plan decision D8) |
| [0075](../decisions/0075-glass-is-a-lakitu-camera.md) | Its own amendment, and [0166](../decisions/0166-kino-monitor-wall-and-lakitu-camera.md) (Proposed) | 0166 proposes amending 0075 point 3 (index row of 0075) | Yes ("see the amendment at the end") | Not checked |

### Headers that do not name a later change

The index row is the only place most of these chains show from the earlier side, and only for some of them. The earlier record's own Status or header lines do not name the later record for: 0002, 0032, 0050, 0051, 0057, 0063, 0067, 0070, 0076, 0085, 0088, 0140, 0152, 0153, 0164, 0196, 0197, 0224 and 0350 (first 12 lines of each read on 2026-11-16). That is how the decisions README intends it: the earlier record is never rewritten. A reader must search forward, for example with `git grep -n "0164" -- docs/decisions`.

## Temporary, one-time and provisional

| Record | Kind | Ends when | Code today |
|---|---|---|---|
| [0149](../decisions/0149-act-budget-suspended-and-metered.md) Act budget suspended, every act metered | Temporary ("accepted, temporary") | The owner sets `GELDAR_ACT_BUDGET_ENFORCE=1`; the record names no date | Still suspended by default (`compose/colo.yml` line 356; `threshold/mcp/README.md` line 87) |
| [0134](../decisions/0134-mind-is-a-profile-until-a-thinker-exists.md) The Mind is a compose profile | Until a Thinker path exists | "a new decision that names the gateway" (0134) | Still under profile `mind` (`compose/colo.yml` line 283) |
| [0339](../decisions/0339-journal-reset-one-time-exception.md) Journal and sleep-mark reset | One-time; "no reset routine" (index title) | Done 2026-11-15 | The [world and memory reset](../runbooks/world-and-memory-reset.md) runbook says it is "not a routine procedure" and gives no commands |
| World-operations exceptions of 2026-11-15 (spawn town, world border) | Bounded exception to Principle 1 | Not stated | No decision record carries them; see [world-operations exceptions](../concepts/world-operations-exceptions.md). Only 0339 is recorded |
| [0077](../decisions/0077-invitee-auth-and-the-0072-0075-login-rule.md) Interim login | Interim, until Entra SSO at Phase 2 | "That replacement is a new record" (0077) | Not checked |
| [0033](../decisions/0033-mock-wake-and-interest-vocabulary.md), [0034](../decisions/0034-mock-result-shapes-and-untrusted-text.md) | "provisional vocabulary", "provisional with the mock" | Not stated; [0143](../decisions/0143-outcome-events-extend-the-provisional-vocabulary.md) (Proposed) extends the vocabulary | Not checked |
| [0061](../decisions/0061-phase-0-exit-criteria-readings.md) to [0065](../decisions/0065-damage-wakes-the-mind.md), [0067](../decisions/0067-nats-accounts-and-least-privilege.md) | Accepted provisionally (orchestrator, owner may revise) | No owner revision recorded. [0066](../decisions/0066-phase0-closed-as-proof-of-life.md) item 4: "Decision 0061's readings stay provisional"; the exit runs that 0064 governs are deferred | Not checked |
| [0062](../decisions/0062-no-settled-credits-in-phase-0.md) | E-8 deferred | Not stated | Not checked |
| [0060](../decisions/0060-persona-size-limits.md) | Status: "the fit check below is OPEN" | The Wave M packet and verification named in the record | `tools/mcp-tokens/src/players.ts` lines 15 and 18: 8192 and 4096 bytes, as the index title says |
| [0186](../decisions/0186-character-sheet-assumed-answers.md) Character-sheet answers | Assumed for planning only; "Nothing is switched on" | Owner answers | Eight files outside `docs/` cite 0186 (count method under [still Proposed](#still-proposed)) (for example `psyche/src/proficiency.ts`); whether anything is switched on was not checked |
| [0221](../decisions/0221-wait-result-deduplicates-static-sections.md) `wait` deduplication | On only for listed lives | Not stated | `compose/colo.yml` cites `GELDAR_WAIT_DELTA_LIVES` |
| [0364](../decisions/0364-known-gaps-against-0137-and-spec-8-4.md) Known gaps | Recorded, not fixed during the freeze | "Each gap closes with a later record" (0364) | See [contradicted by code](#accepted-records-contradicted-by-code) |

## Still Proposed

46 records have a Status line that starts with "Proposed" (command in [status vocabulary](#status-vocabulary)). Many are already in code. The "Files" column counts files outside `docs/` (`.claude/` included) whose text has the four-digit number as a whole word, measured on 2026-11-16 at `dc07e3fa` with:

```powershell
@(git grep -lw 0186 -- . ':!docs' ':!pnpm-lock.yaml' ':!**/verification-metadata.xml').Count
```

It is a citation count, not a check of behaviour. It can over-count (a bare number that is not a decision citation also matches) and a 0 can still hide an implementation (see 0187).

| Record | Proposed by or awaiting | Files | Example file |
|---|---|---|---|
| [0068](../decisions/0068-prompt-v4-and-agent-visible-text.md) | fix-c; owner amends the spec line | 11 | `contract/src/agent-text.ts` |
| [0079](../decisions/0079-credit-numbers-and-charge-rules.md) | Owner confirms numbers and charge rules | 0 | |
| [0082](../decisions/0082-colo-compose-network-and-limits.md) | Orchestrator may accept at the ops merge | 10 | `compose/colo.yml` |
| [0083](../decisions/0083-c1-body-and-mind-image-contents.md) | (no qualifier) | 5 | `animus/Dockerfile.mind` |
| [0084](../decisions/0084-colo-deploy-by-pull-with-a-project-scoped-script.md) | (no qualifier) | 21 | `.github/workflows/colo-deploy.yml` |
| [0087](../decisions/0087-nats-overlay-live-test-and-scoped-subjects.md) | (no qualifier) | 14 | `compose/nats-auth.yml` |
| [0088](../decisions/0088-metrics-exporters-and-replay-window.md) | Wave C1 packet | 8 | `eventsink/src/metrics.ts` |
| [0090](../decisions/0090-public-mcp-contract.md) | Owner to confirm | 21 | `contract/schemas/mcp-common.schema.json` |
| [0091](../decisions/0091-public-mcp-behind-caddy.md) | Owner to confirm | 1 | `threshold/mcp/src/config-public.ts` |
| [0092](../decisions/0092-velocity-spectator-whitelist.md) | Owner to confirm | 4 | `golem/src/registry.ts` |
| [0093](../decisions/0093-glass-hardening.md) | Owner rulings recorded | 3 | `compose/colo.yml` |
| [0094](../decisions/0094-public-sites-read-only-through-caddy.md) | Owner to confirm | 8 | `compose/bluemap-web/Caddyfile` |
| [0095](../decisions/0095-look-projection-and-mcp-image.md) | Owner to confirm | 1 | `threshold/mcp/src/tools/look.test.ts` |
| [0096](../decisions/0096-public-topology-as-built.md) | Orchestrator | 4 | `deploy/colo-up.sh` |
| [0100](../decisions/0100-lakitu-feed-contract.md) | Owner to confirm | 5 | `contract/schemas/lakitu-feed.schema.json` |
| [0101](../decisions/0101-lakitu-feed-plugin.md) | Owner to confirm | 0 | |
| [0108](../decisions/0108-mcp-roster-source-of-truth.md) | Owner review; "the code follows the proposal" | 10 | `body-helper/src/service.ts` |
| [0142](../decisions/0142-stall-and-replan-numbers.md) | Owner confirmation pending | 1 | `golem/src/actions/pathing.ts` |
| [0143](../decisions/0143-outcome-events-extend-the-provisional-vocabulary.md) | Owner confirmation pending | 7 | `contract/schemas/hurt-event.schema.json` |
| [0144](../decisions/0144-death-is-an-event-and-a-dated-fact-and-there-is-no-revive.md) | Owner confirmation pending | 2 | `contract/schemas/death-event.schema.json` |
| [0156](../decisions/0156-agent-viewport-image.md) | Spike result; owner decides | 14 | `contract/schemas/mcp-see.schema.json` |
| [0166](../decisions/0166-kino-monitor-wall-and-lakitu-camera.md) | Implementer; owner rules A4, A9, A10 | 34 | `glass/README.md` |
| [0180](../decisions/0180-chatgpt-harness-enabled-on-colo.md) | Implementer; compliance is the owner's | 2 | `shards/colo-mind.yaml` line 53: `chatgpt: { enabled: true }` |
| [0185](../decisions/0185-per-turn-record-for-kit-minds.md) | "nothing is built or switched on" | 8 | A SQL migration cites 0185 in its first line (conflict 3 below) |
| [0186](../decisions/0186-character-sheet-assumed-answers.md) | Assumed, planning only | 8 | `psyche/src/proficiency.ts` |
| [0187](../decisions/0187-bluemap-skin-provider-in-geldar-core.md) | Owner to accept | 0 | `AgentSkinProvider.java` implements it without citing it |
| [0188](../decisions/0188-genesis-environment-stamp.md) | Awaiting session review | 0 | |
| [0192](../decisions/0192-edit-sign-action.md) | Implementer; owner flips to Accepted | 7 | `golem/src/actions/edit-sign.ts` |
| [0195](../decisions/0195-gravestones-owned-by-system.md) | Owner to accept | 9 | `plugin/core/.../GravestoneListener.java` |
| [0197](../decisions/0197-speech-bubbles-on-the-map.md) | (no qualifier); feature removed by 0310 | 3 | `plugin/core/.../speech/ChatFeedWriter.java` |
| [0199](../decisions/0199-muffled-hearing.md) | (no qualifier) | 34 | `contract/schemas/heard-muffled-event.schema.json` |
| [0215](../decisions/0215-sleep-facts.md) | (no qualifier) | 4 | `golem/src/actions/sleepers.ts` |
| [0216](../decisions/0216-eat-choice.md) | Implementer; owner to accept | 6 | `golem/src/actions/eat-choice.ts` |
| [0217](../decisions/0217-ownership-lookup-counters.md) | Implementer; owner to accept | 4 | `golem/src/body/block-owners.ts` |
| [0220](../decisions/0220-merge-queue-for-main.md) | (no qualifier) | 1 | `.github/workflows/ci.yml` line 11: `merge_group:` |
| [0221](../decisions/0221-wait-result-deduplicates-static-sections.md) | Implementer; owner to accept | 12 | `compose/colo.yml` |
| [0224](../decisions/0224-sleep-failure-detail.md) | Implementer; owner to accept | 2 | `golem/src/actions/sleep-outcome.ts` |
| [0225](../decisions/0225-rest-stat-and-bed-refusals.md) | Implementer; owner to accept | 6 | `golem/src/actions/sleep-refusal.ts` |
| [0226](../decisions/0226-bed-census-in-sleep-failure.md) | Implementer; owner to accept | 4 | `golem/src/actions/sleep-census.ts` |
| [0351](../decisions/0351-paper-telemetry-plugin-scope.md) | (no qualifier) | 0 | |
| [0360](../decisions/0360-documentation-metadata-block-and-sources-field.md) to [0365](../decisions/0365-docs-gates-after-the-freeze.md) | Owner to accept (documentation freeze, six records) | 0 each | Documentation rules, not code |

Two records are Open, not Proposed: [0146](../decisions/0146-c5-open-questions-for-the-owner.md) (wave C5 questions) and [0366](../decisions/0366-open-spec-5-14-watched-wording-versus-0059.md) (spec 5.14 wording against 0059).

## Accepted records contradicted by code

The cheap checks on this page found one Accepted record that the repo contradicts today, and it is already recorded:

1. **[0137](../decisions/0137-public-spectator-proxy-is-separate-and-online.md)** (Accepted). [0364](../decisions/0364-known-gaps-against-0137-and-spec-8-4.md) (Proposed) records that `compose/colo-public.yml` departs from 0137, that 0137 stays authoritative, and that node state is unchecked. Its title is the level of detail this page keeps (decision 0361 point 5).

Near misses, where an Accepted record reads differently from the code but a later record explains it:

- **0057** budget numbers: not enforced by default, because of 0149 (temporary).
- **0050** host processes: true for Phase 0 only; 0078 covers Phase 1.
- **0171** point 2: superseded by 0262 and 0282; a SQL comment on line 10 of `sql/0051_character_audit.sql` still states the old rule, while `sql/0052_character_erase_comments.sql` corrects the table comments. Migrations are not rewritten, so the line stays.
- **0135**: the title says GitHub and Discord; the in-record amendment and `providers.ts` say Microsoft only.

Checks that agreed with their Accepted record: 0006 (`package.json` line 21, TypeScript 7.0.2), 0048 (`RecipeGrantListener.java`), 0060 (`players.ts`), 0150 (`compose/colo.yml` line 442, loopback 18090), 0169 (`deploy/colo-admin.sh` line 173, `on-failure:5`), 0181 (`library.ts`, `colo-mind.yaml`), 0194 with 0337 (`hazard-escape.ts`), 0212 (`compose/colo.yml` line 276, profile `adam`; line 138, `players_sleeping_percentage 50`).

## Conflicts recorded, not resolved

1. **Template against practice.** The README template allows two statuses; 88 records lead with another. Decision [0365](../decisions/0365-docs-gates-after-the-freeze.md) proposes a candidate record-to-index status check (index title). No record settles the vocabulary.
2. **Proposed but in code.** At least 0068, 0108, 0180, 0187, 0192, 0195, 0216, 0220, 0221 and 0224 to 0226 are Proposed while the code follows them (files named above). The records say the owner accepts; the code went first.
3. **0185.** Its Status says "nothing is built or switched on", while a contract schema and a SQL migration cite it. Whether the migration is applied, or the record is switched on, was not checked (node, plan decision D8).
4. **0197 and 0310.** 0310 (Decided) removes 0197's feature; 0197's Status is still "Proposed", and only the index row says "feature removed by 0310".
5. **0088 and 0350.** An Accepted record amends a Proposed one.
6. **0350 and 0352.** 0350 stays "Accepted" with no note of the amendment in its own Status line (plan finding F-5, still true).
7. **0135 format.** The header is run together on one line; the title names providers the record later removed.

## Related

- [Decision timeline](decision-timeline.md): all records in date order.
- [Decisions index](../decisions/README.md) and the record template.
- [World-operations exceptions](../concepts/world-operations-exceptions.md) and [economy and budgets](../concepts/economy-and-budgets.md).
- [Decisions by topic](../reference/decisions-by-topic.md): every record grouped by component.
