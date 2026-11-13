# Phase 1 resume

Read this first, then the plan. Rewrite it at each wave boundary; keep it under 80 lines.

## Goal

The shard runs in its final Colo environment, reachable from the internet without a VPN, invite-only, and not announced ([decision 0070](../../decisions/0070-phase1-is-the-colo-first-shard.md)). Phase 1 ends when the exit run in the plan passes, not when the packets merge.

## Where things are

- **Phase 0:** closed as proof of life by [decision 0066](../../decisions/0066-phase0-closed-as-proof-of-life.md). The spec's exit criteria are waived by the owner, not met. The first ranger (a real client, operated by a person) has played on the Phase 0 shard.
- **Status:** [phase0/RESUME.md](../phase0/RESUME.md) (Phase 0 state, open gaps, the Phase 1 backlog).
- **Plan:** [plan.md](plan.md) (waves C1, C2, C2b, C3, C4; owner items in section (f); first-ranger lessons in section (g)).
- **Retrospective:** [phase0-retrospective-for-phase1.md](phase0-retrospective-for-phase1.md).
- **Conventions:** [packet-conventions.md](packet-conventions.md) (card format, contract-first order, shared-file owners, gates, briefs, decision numbers, index lines, pre-packet decisions).
- **Packets:** [packets/](packets/): `c1-packets.md`, `c2-packets.md`, `c2b-packets.md`, `c3-packets.md`, `c4-packets.md`, `c5-goldar-packets.md`, `c7-user-management-packets.md`, `c7b-packets.md`, `c7-wave-plan.md`.
- **Ledger:** [ledger.md](ledger.md) (one row per packet: wave, lane, depends, status, decision numbers, owner-blocked).
- **Decision numbers:** [packets/decision-number-registry.md](packets/decision-number-registry.md). Phase 1 blocks reserve 0081 to 0129; the next free number is 0147 (see item 8 for C5).

## Stop: do not open the public Minecraft port yet

Do not set `GELDAR_MC_BIND` or `GELDAR_MC_PORT` on the node until C2-02c merges. On `main`, `compose/colo-public.yml` still publishes the offline-mode bot ingress, which has no authentication (C2-R2 finding R2-01; decision 0137). The UniFi forward exists, but nothing listens behind it until those variables are set.

## Where the campaign is (2026-11-11, morning)

1. **C1 code is merged.** Still open in C1: **C1-10**, the owner's run on the node. The first ranger is Jason, the Red Ranger (`ag-jason-01`), a sovereign player agent. His Claude Code session runs under the owner's login. The Colo stack on the node has been stopped since its last failed start; PR #78 fixed those failures, and a redeploy is still to do. Also open: the C1-01 leftovers (FX-SPAWN, PR #100).
2. **C2 desktop work is merged:** C2-00 to C2-06, C2-02b, C2-07a1 to C2-07a3, C2-07b and C2-08a (PRs #79 to #99).
   - In flight: C2-07c1 (#102), C2-07c2 (#101), and C2-07d (the admin Glass secret mount and pre-creating the BlueMap webroot).
   - The edge is in place: the UniFi forward and the DNS names exist (owner-held values in `~/.config/geldar/colo-edge.md` on the owner's machine).
3. **C2 wave review, round 1.** Findings and owners are in [worknotes/wave-c2-review-1.md](worknotes/wave-c2-review-1.md).
   - R1 (MCP) fix slices: M1 merged, B2 merged, M2 running.
   - R3 (Glass) fix slices: A1 merged, B merged, A2 running.
   - Still to start: R2 (Velocity, including the ghost default-mode window) and R4 (node and Caddy, including the `colo-public.sh` re-install gap). Round 2 then targets the fix commits first.
4. **Self-registration (0135)** is designed: GitHub and Discord sign-in, no manual approval. Its cards are in [packets/c2-register-packets.md](packets/c2-register-packets.md). C2-08a is merged; C2-08b and C2-08c come next. Turning registration on waits for the C2 gates and for C2-08d (the per-player Body lifecycle).
5. **C2b:** C2b-00 and C2b-01 (session 1) are merged. Next: the C2b-01 load test (live lane), C2b-02 (the relay), and C2b-03a (the renderer).
6. **Every ruling made tonight** is in [worknotes/orchestrator-2026-11-11.md](worknotes/orchestrator-2026-11-11.md) (R1 to R28, the owner answers, flakes).
7. **Owner items still open:** the C1-10 run; creating the GitHub and Discord OAuth apps; the C2b questions (texture licence, audit retention, the feed load budget); 0079 (credits); and confirming R21 (Glass hides the prompt) or signing a privacy review.

8. **Wave C5, Goldar learnings (drafted 2026-11-11, parallel to C1 to C4):** Body parity and the unavailable tools, from the review of the goldar repo. Cards: [packets/c5-goldar-packets.md](packets/c5-goldar-packets.md); review: [worknotes/goldar-review.md](worknotes/goldar-review.md); ledger section "Wave C5"; decisions 0141 to 0146 are Proposed or Open (owner to confirm); rulings R47 to R54. C5a (C5-00 first, then 01 to 04 in parallel) and C5b (05 then 06; 07 parallel) are Ready except C5-01; C5c (08 to 10) waits on 0146. Next free decision number: 0147.

9. **Wave PX, perception for body and mind (drafted 2026-11-11):** what a player could see or hear, from the Jason play record (defects D1 to D11). Cards: [packets/px-perception-packets.md](packets/px-perception-packets.md); ledger section "Wave PX"; owner rulings in decision [0154](../../decisions/0154-perception-owner-rulings.md) (Decided; the seven rulings; spider is a conditional mob under ruling 1, settled by the orchestrator). PX-1 and PX-0 wait on C6-BODY-EVENTS merging; PX-2b is unblocked. Decision 0154 is the only number this wave uses; 0147 to 0153 are not free for it (0147 to 0149 are on in-flight branches, 0150 is on main, 0151 to 0153 are wave C7).
10. **Wave C7, user management (replanned 2026-11-13):** plan, waves, migrations 0024 to 0033 and live lane in [packets/c7-wave-plan.md](packets/c7-wave-plan.md); cards in [packets/c7-user-management-packets.md](packets/c7-user-management-packets.md) and [packets/c7b-packets.md](packets/c7b-packets.md); ledger section "Wave C7". Owner questions Q1 to Q8 are answered: [0170](../../decisions/0170-owner-management-values-and-admin-flag.md) (values and the admin flag), [0171](../../decisions/0171-account-erasure-rule.md) (erasure), [0172](../../decisions/0172-human-skin-upload-held-for-approval.md) (skin upload held for approval). Merged: C7-01, C7-08, and wave 1 (see the C7 status below). Sign-up stays closed until C7-11 and the owner approves.

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

## C7 status (2026-11-13)

- **Wave C7-1 done** (merge bbb5ed6b, PR #315): C3-04s, C7-12, C7-03a (package only), C7-02a (SQL and service only). Migrations 0024, 0025, 0027 and 0032 are applied on the node; spare left: 0033. Retro: [retro/wave-c7-1.md](retro/wave-c7-1.md). Plan and waves: [packets/c7-wave-plan.md](packets/c7-wave-plan.md).
- **Wave 2 next:** C7-02b (owner keys), C7-05 (onboarding), C7-03b (supervisor wiring; needs geldar-93 contact first), then C7-04 (API v1). Deploy protocol: MERGE and DONE go to geldar-93 and geldar-ops; every image-changing merge refreshes the ranger hosts, so batch them.
- **Open owner items:** the erasure rule review (0171; gates C7-11 only); the geldar_supervisor Postgres password (an operator step, by hand, before C7-03b); the C7-10 reason codes and its two count and index decisions.

## Open contradictions

- The C3 cards and plan.md disagree on the soak length. Both are listed as O-soak; no packet states a duration as settled.
- [phase0/RESUME.md](../phase0/RESUME.md) still says the campaign retro is pending, but `docs/analysis/phase0/retro/campaign.md` exists.
