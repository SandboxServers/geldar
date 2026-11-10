# Phase 0 retrospective for Phase 1

Status as of 2026-11-10, branch `docs/phase1-analysis`. This is an analysis, not a decision. It reads the spec ([docs/spec.md](../../spec.md), not edited), the packets ([work-packets.md](../phase0/work-packets.md)), the ledger ([README](../phase0/README.md)), the decision records ([index](../../decisions/README.md)), the wave retros in [retro/](../phase0/retro/) and the resume card ([RESUME.md](../phase0/RESUME.md)).

Evidence tags: **[verified]** means this document checked it against the repo on this branch. **[analyst A/B/C]** means it comes from one of three read-only analyst findings (A: spec vs packets; B: decisions and amendments; C: outcome and process). Analyst findings were treated as data. Anything marked **[unchecked]** was not re-counted here.

## 1. Spec said vs packets said

Each Build bullet and Exit bullet in spec section 10, Phase 0 (lines 1398 to 1411), mapped to the packets that were supposed to deliver it.

| Spec deliverable or exit criterion | Packets | Status |
|---|---|---|
| Build: Body benchmark (20 TPS, 100%) | P0-07a to P0-10c | Built; passed in every scenario at the recorded commits, 10/5 TPS informational [analyst C; bench-results.md unchecked] |
| Build: Geldar-Core, event export and ingress | P0-11 to P0-13 | Built [analyst A] |
| Build: reflexes | P0-14, P0-15a/b/c | Built [analyst A] |
| Build: container actions | P0-09b | Built [analyst A] |
| Build: intents | P0-16 | Built; the three-intent exit was never run (see section 2) [analyst A, C] |
| Build: attention controller | P0-27 | Built [analyst A] |
| Build: memory and reflection | P0-28, P0-31 | Built; no-plan and damage wakes added later (0065, 0069) [analyst A] |
| Build: Thought Stream v0 | W6-09 to W6-11 (`glass/`) | Built [analyst A] |
| Build: threat model | P0-00 | Done [analyst C] |
| Build: restart resume | P0-18 | Built; the live test stops the Body in-process, it does not kill it [analyst A] |
| Exit: 5 in-game days and 24 real hours | none runs them; mechanism in place | Deferred, then waived (0061, 0064, 0066) **[verified: RESUME.md line 19]** |
| Exit: three durable intents, no model call | P0-16 | Deferred, never run [analyst C] |
| Exit: every action has a receipt | P0-09b, P0-27 and receipt packets | Partial: receipts only for plan actions; `prepared` and `aborted` not built (0020) [analyst A, C] |
| Exit: Body restart mid-intent resumes | P0-18 | Partial: built; crash reconciliation partial (known-gaps, size L) [verified: plan.md section (b)] |
| Exit: thought latency under 15 s | smokes only | Unverified at spec scale: 0.6 to 7.7 s on the 8B smokes [analyst A] |
| Exit: model floor and calls per useful minute recorded | none | Deferred, waived (0061) [analyst C] |
| Not in spec: sovereign players, rangers, skins | Wave M (WM-01 to WM-13) | Pulled forward from Phase 3; see section 3 |

## 2. Where Phase 0 ended up

Decision [0066](../../decisions/0066-phase0-closed-as-proof-of-life.md) closed Phase 0 on 2026-11-10 as proof of life. The owner waived the spec section 10 exit criteria. No exit criterion was met as written. The table uses four states: **met** (run and passed), **waived** (owner accepted without a run), **deferred** (not run, planned later), **unverified** (built or partly built, but no verdict at spec scale).

| Exit criterion | State | Evidence |
|---|---|---|
| Benchmark 20 TPS at 100% (Build) | met | Gate pass at several commits; 10/5 TPS informational [analyst C] |
| Threat model (Build) | met | P0-00 done [analyst C] |
| 5 in-game days, 24 real hours | waived; deferred | 0066; exit runs OPS-2, OPS-3, OPS-4 not run [verified: RESUME.md line 19] |
| Three durable intents, no model call | deferred | Never run [analyst C] |
| Every action has a receipt | waived; partial | Plan actions only; 0020 [analyst A] |
| Restart resumes mid-intent | unverified | Built; live test is in-process, not a kill; crash reconciliation partial [analyst A] |
| Latency under 15 s | unverified; waived | Smokes only, 0.6 to 7.7 s on 8B [analyst A]; one 8-minute 32B run, p50 3728 ms, recorded only in a session record [analyst C] |
| Model floor, calls per useful minute | deferred; waived | 0061 defines readings; not measured [analyst C] |
| Bed, food and stone tools (survival terms) | unverified | Terms too vague to packetise (wave6-packets.md lines 20 to 31) [analyst A] |
| Clean 20-minute smoke | unverified | Not done; W6-08 not done [verified: ledger status line; analyst C] |

## 3. What was added beyond the spec, and why

| Addition | Basis | Why it happened |
|---|---|---|
| Wave M: sovereign MCP, token CLI, player host, skins (WM-01 to WM-13) | 0052 to 0057 | Owner wanted rangers alongside Adam; spec puts this in Phase 3 (5.15). About a sixth of all packets [analyst A] |
| Velocity and identity plugin from day one | 0021 | Scope pulled forward [analyst B] |
| NATS accounts and least-privilege users | 0067 | Shipped open; only the campaign review found it [analyst B] |
| Glass hardening and public Glass | 0061 (item 11), 0072 | Public Glass overrides spec 8.4 SSO [verified: 0072 index row] |
| Lakitu cameras | 0075 (proposed) | Owner requirement, recorded as proposed |
| Process packets W1-process to WM-process | ledger rows | Apply each wave's retro actions [verified: ledger] |
| Fix rounds A to F; W6-20 to W6-22 | campaign review | Found by the nine-reviewer campaign review [analyst A, C] |
| adam-run harness and report generator | W6 | Its first live run was the exit attempt, so harness bugs consumed wave 6 [analyst A; retro/campaign.md section 4] |
| Recipe discovery P0-19 and knowledge boundary | 0048, 0058 to 0060 | Owner ruling; recipe book reversed [verified: 0048 index row] |
| Shelter, no-plan wake, damage wake | 0074, 0069, 0065 | From live runs [analyst A] |

Analyst A's judgment: the sovereign and ranger work took the time that the exit runs needed. This is a judgment, not checked.

## 4. Decisions and amendments

### 4.1 Counts by class [analyst B; main has 62 records]

On `origin/main`, [docs/decisions/](../../decisions/) holds 62 records: 0001 to 0006 and 0020 to 0075 **[verified]**. Records 0007 to 0016 are on branch `docs/scriptorium-decisions` only, and 0017 to 0019 were never written **[verified]**. Analyst B read 72 records and counted by primary class: spec gap filled 23; owner ruling 17; implementation choice 16; spec correction 6; spec contradiction or departure 5; process rule 3; scope pulled forward 2. About 35 of the 72 amend or depart from a spec statement. Analyst A's summary says 74 records; this does not reconcile with the 72 that B read and with the 62 on main, and was not resolved here **[unchecked]**.

Decisions 0061 to 0065 and 0067 are marked "Accepted provisionally (orchestrator, owner may revise)", and no owner confirmation is recorded **[verified: index rows]**. Decision 0062 says the same. Those are the rules Phase 1 relies on most.

### 4.2 Recurring causes [analyst B]

- **Platform-bound names and versions:** gamerules (0024), Paper and Java pins (0022), Claude Code settings (0016), Mineflayer behaviour on 26.1 (0030, 0032, 0037, 0039).
- **Numbers that disagree with the spec:** owner cap 3 against 20 (0052); credits, spec 5.7 line 642 at 6 to 8 per real hour against 0057 at 30 per real hour with cap 240; wait cap 300 s against 240 s (0009); persona sizes (0060); "exactly four ports" (0071). **[verified: spec line 642; 0057 text]**
- **Topology and ports:** 25565 taken on the node; Caddy for Cloudflare; Mind on the desktop (0050); body state in NATS KV (0043); colo (0070).
- **Auth:** OAuth against static tokens (0054); Entra SSO against public Glass (0072); NATS open (0067).
- **Terms and the knowledge boundary:** the observers sentence (spec about line 1584) against 0059 and 0068; recipes (0048); bed against shelter (0074); "player" against "agent".
- **Spec contradicting itself:** player kit (0009); Phase 1 excludes the Shrine but its exit needs one (0070) **[verified: plan.md section (a)]**.

### 4.3 Late decisions that cost rework [analyst B]

- Recipe book: 0032 had the shard grant it; wave 3 built RecipeGrant; 0048 and 0058 reversed it.
- Time dilation: 10/5 TPS rows were built before 0038 measured that they do nothing; 0047 settled it.
- Observers sentence: spec line 1584 went into prompt v3, the schema text and the persona; 0059 and 0058 ruled against it; fix-C caught it late, forcing prompt v4, persona lint and v5.
- Cap of 20 was not enforced until review (`sql/0006`).
- Wave 1 records 0023 to 0028 were held to wave end because the orchestrator could not write records.
- NATS shipped open; 0067 came only from the campaign review; the overlay is untested live.
- Wave M referenced 0053 and 0060 before those files existed.
- Neutral text, the book joiner rule and RCON per admission have no record.
- The first ranger run needed 0069 and 0074, the top-level `oneOf` drop, `build` with no handler, and MCP sleep marking when refused.
- Numbering collisions: 0066 twice; 0068 listed before 0067 **[verified]**; the resume card named a taken number (section 7).

### 4.4 Amendments still open, including those missing from 0073's table

[0073](../../decisions/0073-spec-is-never-edited.md) has a table of open amendments. Checked against it **[verified]**: the table has 11 rows (observers sentence, cap 3 against 20, terms, personal names, OAuth, Mind location, Cloudflare, Entra SSO, port 25565, Phase 1 exclusion against exit, four ports).

Open and **not** in that table:

1. Credits: spec 5.7 (line 642, 6 to 8 per real hour, cap 24 hours) against [0057](../../decisions/0057-sovereign-budget-numbers-and-wake-spacing.md) (30 per real hour, cap 240). Also 0062 (no settled credits in Phase 0; E-8 deferred). **[verified]**
2. [0075](../../decisions/0075-glass-is-a-lakitu-camera.md) against [0072](../../decisions/0072-glass-and-bluemap-are-public.md): cameras need a login while Glass is public. The fork is open (point 5 of 0075).
3. [0074](../../decisions/0074-shelter-means-an-enclosed-safe-space.md) amends spec 5.4 (bed as the only rest) **[analyst B]**.
4. [0049](../../decisions/0049-thinker-job-gets-response-format-and-reasoning.md) amends the wording of Appendix H **[analyst B]**.
5. Spec line 293: camelCase `keepInventory` **[analyst B]**.
6. [0043](../../decisions/0043-phase0-body-state-in-nats-kv-and-record-rules.md) (body state in NATS KV, not Postgres) and [0021](../../decisions/0021-velocity-from-phase0.md) and 0026 are real departures that were never tabled **[analyst B]**.
7. [0053](../../decisions/0053-public-mcp-through-an-outbound-tunnel-deferred.md) is not marked superseded by [0071](../../decisions/0071-public-endpoints-and-ports.md). **[verified: 0053 status reads "Accepted (owner ruling; Q1 and Q2 open)"]**
8. [0060](../../decisions/0060-persona-size-limits.md): prompt fit against `num_ctx` 8192 is open **[analyst B]**.
9. Open after 0071 and 0072: the delay value; whether living sovereign players show on Glass; whether the agent board is agent-readable **[analyst B]**.
10. [0007](../../decisions/0007-spec-frozen-at-v0.8.md) (on the scriptorium branch only) still says nobody edits the spec, not even the owner. 0073 says only the owner may change it **[verified]**. See section 7.

## 5. Process

### 5.1 What worked

- Small unblocker first, then fan-out (P0-14, then P0-20 and P0-21) [analyst C].
- One integration coder owning shared interface files.
- Reviews split by surface, and the campaign review with nine reviewers.
- Commit-per-item plus a progress file: wave 3 had no context-cap finishers after this [analyst A].

### 5.2 What broke, with counts

- Coder context cap at about 90k tokens, after 40 to 60 tool uses. Wave 1: 3 of 7 packets hit the cap. Wave 2: almost every first attempt. Wave 5: R4c and R4d each needed 3 finishers. Wave M: 11 of 13 packets needed 1 to 3 finishers. Judgment: about 25 to 30 of 83 packets needed a continuation [analyst A, judgment].
- The stated budget was 40k working tokens; actual use was 60k to 95k [analyst A].
- Commits on main: 1,377 in three days (120, 690 and 567 per day). About 392 `fix` subjects, about 208 merges, 38 first-parent merges, 83 ledger rows, and about 200 worktree folders still present [analyst C].
- Shared append-only worknotes caused add/add conflicts; now one worknote per packet [analyst C].
- Wrong-worktree edits: twice in wave 3, several in wave 5 [analyst C].
- `decisions/README.md` is a hotspot (judgment) [analyst A].
- Two decisions numbered 0066 [analyst B].
- Fix rounds regressed repeatedly (waves 3, 4 and M). Many tests passed with the fix reverted. Wave M limiter fixes caused HIGH regressions [analyst A, C].
- Flaky timing tests under parallel load (golem test-control, adam-stack, repo-checks cli, threshold and mcp imports, lantern-local reconnect); not fully identified [analyst C].
- Live lane took about 11 minutes for 58 to 73 tests, one runner at a time [analyst C].
- The orchestrator hand-patched code. The owner ruled that the orchestrator writes none; ops does merges, checks and live runs [analyst C].
- Ops ran `adam up` and `adam up --help` (port 7410 stuck). The `.claude/agents/ops.md` file is missing [analyst C].
- CI skipped 43 integration tests; no pin-rule check existed; packages were 4 to 8 days old [analyst A].
- Spec gaps 0023 to 0028 were recorded at wave end, not when found [analyst B].

### 5.3 Review yield

- **High yield:** wave review round 1 (17 to 49 findings per wave); live passes; the nine-reviewer campaign review. It found admission by name after a Body dies, unauthenticated NATS, a TPS rule that never fired, report criteria that passed with no data, and CI-skipped integration tests [analyst A, C].
- **Low yield (judgment):** rounds 2 and 3, which were mostly regressions from the previous fix; open-ended watches [analyst C].
- Live runs found what mocks missed: table-craft `stateId`, chests losing items, `craft stick 4` making 16, burrow digging by block name, the event sink poison pill, silently dropped events after a Postgres outage, a 401 on the token reader, act with no limits, and top-level `oneOf` and `anyOf` schemas silently dropped by Claude Code [analyst C].

## 6. What Phase 1 changes because of this

Each rule is a concrete instruction for every Phase 1 packet. The full conventions are in [packet-conventions.md](packet-conventions.md).

1. **Five pre-packet decisions come first**, as proposed records 0076 to 0080. Evidence: section 4.3 (late decisions) and [plan.md](plan.md) section (b). See the records.
2. **Each packet reserves a decision block** before it starts; a coder uses only numbers in its block. Evidence: the numbering collisions and the 0066 duplicate (section 5.2).
3. **Each record is added to the index in the same commit**, and the decision-index check runs at every packet gate. Evidence: 0068 listed before 0067; the repo-checks decision-index test requires every record to have a row in `docs/decisions/README.md`.
4. **Contract first.** One small unblocker packet changes `contract/` and its generated output, merges, then fan-out starts. Fan-out packets never touch `contract/`. Evidence: shared-file collisions needing an integration coder (wave 4 retro, line 31).
5. **Shared files have one owner per wave**, listed in the conventions table. A packet that needs a shared-file change writes an "index line to add" in its worknote. Evidence: add/add conflicts (section 5.2).
6. **Packets fit the budget:** about 40k working tokens, one area, commit per item, "commit what passes, report the rest". Packets that touch compose or live stacks get two sessions. Evidence: the 25 to 30 continuations and the 60k to 95k actual use.
7. **Split files over 500 lines before touching them.** Named: `thinking-loop.ts` (611), `thinker.ts` (587), the mcp-mock `server.ts` (565), `adam-run` `adapters.ts` (514). Evidence: [analyst A, B; file sizes unchecked on main].
8. **Each brief gives the absolute worktree path and the never-do list**, including no `adam up`, no state-changing probes, and never weakening a test or verdict. Evidence: wrong-worktree edits and the `adam up` run.
9. **Every behaviour change has a revert-check.** The coder reverts the change, runs the test, confirms it fails, and says so in the report. Evidence: "many tests passed with the fix reverted" (section 5.2).
10. **Live runs use a real client, and every wave has one.** Evidence: the top-level `oneOf` drop and the first ranger run, which only a real client caught.
11. **Public surfaces get a security review every wave**, and the campaign has an adversarial review at its end. Evidence: unauthenticated NATS and the nine-reviewer campaign review.
12. **Flaky tests are fixed or quarantined with a named owner, never weakened.** Use injected clocks and a flake log. Evidence: the flaky-test list (section 5.2).
13. **Integration case-count floor in `check`.** Evidence: CI skipped 43 integration tests.
14. **Pin and release-age check, and the decision-index drift check, land before fan-out.** Evidence: packages 4 to 8 days old; the index drift.
15. **Decisions are not provisional for long.** A provisional record (0061 to 0065, 0067) gets an owner confirmation or a superseding record at the wave boundary. Evidence: section 4.1.
16. **Spec gaps are recorded when found,** in the packet's worknote, and become a record in the same wave. Evidence: 0023 to 0028 recorded at wave end.
17. **Restore RESUME and the ledger before fan-out.** Evidence: section 7.

## 7. Open correctness items found while analysing

Each item was checked against the branch unless marked otherwise.

1. **Stale RESUME next-free number.** [RESUME.md](../phase0/RESUME.md) says the next free decision is 0069. **[verified]** 0069 to 0075 exist; the next free number on main is 0076.
2. **Ledger retro "pending".** Analyst C says the ledger calls the campaign retro pending. **[verified: not reproduced]**: rows W6-23 and W6-24 read Done, and [retro/campaign.md](../phase0/retro/campaign.md) exists. The status line in the ledger README does not say "pending" in the text checked. Verify on main before fixing.
3. **Missing 0017 to 0019.** Never written **[verified]**. Recommended: leave the gap; a README note says gaps are fine (the README says so) **[verified]**.
4. **0053 not marked superseded.** It says "Accepted (owner ruling; Q1 and Q2 open)". 0071 settles the public topology. **[verified]** Fix: a new record supersedes it or it is marked with a status line naming 0071. Records are never rewritten, so use a superseding record.
5. **0007 against 0073 on the spec-edit rule.** 0007 (on the scriptorium branch) says nobody edits the spec, not even to fix a typo. 0073 (on main) says only the owner may change it. **[verified]** Fix: 0073 is the live rule; 0007 is on another branch and should be marked superseded by 0073 when that branch merges.
6. **Missing from the 0073 table:** items 1 to 10 of section 4.4.
7. **0067 listed after 0068** in the index. **[verified]** Fix: reorder when the index is next edited.
8. **Two decisions numbered 0066** in history **[analyst B]**. On main there is one 0066 **[verified]**.
9. **Analyst A's record count (74) does not match** the 72 that B read or the 62 on main. **[unchecked]**.
10. **Ledger rows and the RESUME card disagree on the status of W6-08**: the ledger says not done, unverified **[verified]**; analyst A says a clean OPS-1 smoke was never done **[analyst A]**.
