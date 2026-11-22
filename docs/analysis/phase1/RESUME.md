# Phase 1 resume

Read this first, then the plan. Rewrite it at each wave boundary; keep it under 80 lines.

## Goal

The shard runs in its final Colo environment, reachable from the internet without a VPN, invite-only, and not announced ([decision 0070](../../decisions/0070-phase1-is-the-colo-first-shard.md)). Phase 1 ends when the exit run in the plan passes, not when the packets merge.

## Where things are

- **Phase 0:** closed as proof of life by [decision 0066](../../decisions/0066-phase0-closed-as-proof-of-life.md). The spec's exit criteria are waived by the owner, not met. The first ranger (a real client, operated by a person) has played on the Phase 0 shard.
- **Status:** [phase0/RESUME.md](../phase0/RESUME.md) (Phase 0 state, open gaps, the Phase 1 backlog).
- **Other campaigns** that run inside Phase 1 (sheet and harness, genesis, telemetry, world operations, NeoForge): the table in [AGENTS.md](../../../AGENTS.md), each with its own RESUME. Merged on 2026-11-21 (from `git log --first-parent`): the genesis, telemetry, DR-1 (#863) and sheet (#864) PRs, decision 0391 (#851); this file does not track them.
- **Plan:** [plan.md](plan.md) (waves C1, C2, C2b, C3, C4; owner items in section (f); first-ranger lessons in section (g)).
- **Retrospective:** [phase0-retrospective-for-phase1.md](phase0-retrospective-for-phase1.md).
- **Conventions:** [packet-conventions.md](packet-conventions.md) (card format, contract-first order, shared-file owners, gates, briefs, decision numbers, index lines, pre-packet decisions).
- **Packets:** [packets/](packets/): `c1-packets.md`, `c2-packets.md`, `c2b-packets.md`, `c3-packets.md`, `c4-packets.md`, `c5-goldar-packets.md`, `c7-user-management-packets.md`, `c7b-packets.md`, `c7c-packets.md`, `c7d-packets.md`, `c7e-packets.md`, `c7f-packets.md`, `c2-register-packets.md`, `px-perception-packets.md`, `c7-wave-plan.md`.
- **Ledger:** [ledger.md](ledger.md) (one row per packet: wave, lane, depends, status, decision numbers, owner-blocked).
- **Wave C7:** plan and migrations in [packets/c7-wave-plan.md](packets/c7-wave-plan.md); owner questions Q1 to Q8 are answered in [0170](../../decisions/0170-owner-management-values-and-admin-flag.md), [0171](../../decisions/0171-account-erasure-rule.md) and [0172](../../decisions/0172-human-skin-upload-held-for-approval.md). Status: the C7 status section below. Sign-up stays closed until C7-11 and the owner approves.
- **Decision numbers:** [packets/decision-number-registry.md](packets/decision-number-registry.md). Phase 1 blocks reserve 0081 to 0129. The next free number is not recorded here: check `docs/decisions/` and the registry, which is stale (on origin/main 2aa29c3a the highest file on 2026-11-21 is `0391-operator-rulings-2026-11-20.md`). 0174 to 0179 are reserved for C7 design points. 0189 and 0193 have no file on origin/main as of 2026-11-20; not checked against in-flight branches.

## Stop: do not open the public Minecraft port yet

Do not set `GELDAR_MC_BIND` or `GELDAR_MC_PORT` on the node until C2-02c merges. On `main`, `compose/colo-public.yml` still publishes the offline-mode bot ingress, which has no authentication (C2-R2 finding R2-01; decision 0137). The UniFi forward exists, but nothing listens behind it until those variables are set.

## Who does what

- **The orchestrator writes no code.** It briefs, reserves decision numbers, reads reports, and decides the next packet.
- **A coder per packet.** One git worktree per packet under `.claude/worktrees/`, one branch, one brief with the absolute worktree path and the never-do list. Coders commit only the files their card names.
- **Ops merges and runs.** Ops merges wave branches, writes the index lines named in packet-conventions section 7, and runs the node steps.
- **Owner.** Confirms decisions, signs off runbooks and the chaos day, answers owner questions, and makes every spec amendment.
- **At most about six agents at once** (packet-conventions section 5; the machine has limited memory).

## Gates

- **Per packet** (packet-conventions 4.1): the packet's targeted tests pass; each behaviour change has its named test, and the change is reverted locally to confirm the test fails without it; the report says which.
- **Per wave boundary** (4.2): full `./geldar.ps1 check` with the integration case-count floor set at the start of the wave; one read-only review per surface, with a narrow brief, and a fix round that aims only at the findings; one live run with a real client, recorded step by step in the worknote; the wave retro.
- **Per campaign boundary** (4.3): an adversarial review by reviewers who did not write the code; the full soak and the chaos run; a security review of every public surface (the Thinker gateway stays private until it passes); spec-amendment reconciliation against [decision 0073](../../decisions/0073-spec-is-never-edited.md), one line at a time, by the owner; the campaign retro.

## Never-do list

Every brief carries the list in [packet-conventions.md](packet-conventions.md) section 5. In short: never weaken a test, fixture or verdict to pass; never `git reset`, `git stash` or `git checkout` on tracked work; never edit `docs/spec.md`; never push, open a PR, or prune a worktree; never run `adam up` on the node; never retry a flaky test until green.

## Standing owner rules

- **`docs/spec.md` is never edited** by any packet or agent. Amendments are listed in decision 0073 and made by the owner.
- **No secrets, tokens, account names, personal names, or public or private-network addresses in the repo.** Worknotes use placeholders. The node, the DNS zone and the telemetry targets stay in the owner's terminal.
- **Principle 1** (spec section 2): no humans inside. Humans observe through the map, the thought stream and silent cameras; they never speak, build, give items or intervene. If something breaks, fix the infrastructure, not the story.
- **Agents must not learn they are watched** (decisions [0059](../../decisions/0059-identity-mode-is-about-human-observation-not-agent-belief.md) and [0068](../../decisions/0068-prompt-v4-and-agent-visible-text.md)). Agent-visible text, including prompts and wake strings, passes the scans in the packet cards and never shows operator, Glass, BlueMap or observer data.
- **Prompts are versioned and released versions are never edited.** v1 to v5 are released and not edited; v6 is reserved by C3-03 and v7 by C4-06 (neither released); each creates a new version.

## C7 status (2026-11-21; list checked against origin/main a62ceb44, C7-13a re-checked against 2aa29c3a)

- **Merged:** C7-01 to C7-08 waves 1 to 4 (#315, #321, #336, #346); C7-14 and C7-14b (#338, #359); C7-04d and its mount (#365, #380); C7-06c status line (#366) and C7-06d account page (#539); C7-03c1 to c3 (#415, #421, #447); C7-03b5 (#503); LEGAL-SERVE (#404); SIGNUP-RUNBOOK (#517); ROSTER-AUTO (#515, migration 0061); BH-1 (#525), BH-2 (#527), BH-3 (#530), BH-5a (#537), BH-5b (#573), BH-6 (#575); C7-09a2 (#470), C7-09b (#524, #541), C7-09c (#577); the sign-up gate C7-11 (#576); C7-13a (#850, 2026-11-21).
- **Ownership gate (branch phase1/mc-ownership, not merged):** Java ownership check on NEW sign-up behind REGISTER_REQUIRE_MC_OWNERSHIP (exact `true`, OFF everywhere). Decision [0395](../../decisions/0395-mc-java-ownership-gate-on-sign-up.md). Runbook: [open-signup.md](../../runbooks/open-signup.md) Section 7. Blocker: the owner files the Mojang app review form (aka.ms/mce-reviewappid); nothing says it is filed or approved. Bedrock is not checked.
- **Open:** C7-03b2 (PR #522, held); C7-03b4-live; BH-4 folded into BH-1 to BH-3 (no separate card); C7-13b and c (skin moderation, skin form); C7-07 rename; C7-10 operator console; the account-page export link and the PATCH visibility toggles; GX-05c turn_records (geldar-3b); CF-W4-1 to CF-W4-5.
- **Not recorded here:** which merged migrations (0061, 0062, 0063 and 0065) are applied on geldar-93. Check the deploy record first.

## What is left to open sign-up (owner-facing)

1. Rule on whether M1 waits for C7-09 and C7-13 (the open 0261 question).
2. Legal review of the erasure rule (0171; gates C7-11).
3. Ship or drop C7-03b2 (PR #522); give the geldar-93 node steps (helper, RCON whitelist verb, life key).
4. BH-4 has no card (owner ruling): its helper secret-file scope is folded into BH-1 to BH-3 and `docs/runbooks/body-helper-node-steps.md`. Rows 14 to 18 of `docs/runbooks/open-signup.md` need BH-1 to BH-3 merged and those node steps run.
5. Open-signup.md row 25a is accepted as manual cleanup of lost-container life ids (row 4). No whitelist source is needed; BH-6 (#575) removes the whitelist entry first.
8. C7-13a (skin upload, [0172](../../decisions/0172-human-skin-upload-held-for-approval.md)) merged as #850; C7-13b and C7-13c remain. Open-signup.md row 20 is done; row 23 is dropped from the minimum path.
6. The account-page export link and the PATCH toggles, or an owner call to open without them.
7. CF-W4-5 (`__Host-` cookie prefix) before sign-up opens.
9. Open sign-up by `docs/runbooks/open-signup.md`, kill switch off, only after items 1 to 8.

## For the owner

- (a) Kept agent rows may carry a typed real name: anonymise on deletion, or accept.
- (b) built (geldar-93 default, revertable before sign-up opens): `kino_audit` rows of the deleted identity are erased on deletion.
- (c) Cleanup of accounts deleted before 0040 (under 0039): card `C7-09c` (merged #577; whether the operator run has happened is not recorded).

## Open contradictions

- The C3 cards and plan.md disagree on the soak length. Both are listed as O-soak; no packet states a duration as settled.
