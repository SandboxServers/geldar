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
- **Packets:** [packets/](packets/): `c1-packets.md`, `c2-packets.md`, `c2b-packets.md`, `c3-packets.md`, `c4-packets.md`.
- **Ledger:** [ledger.md](ledger.md) (one row per packet: wave, lane, depends, status, decision numbers, owner-blocked).
- **Decision numbers:** [packets/decision-number-registry.md](packets/decision-number-registry.md). Phase 1 blocks reserve 0081 to 0129; the next free number is 0131.

## Where the campaign is (2026-11-11)

1. **C1 code is merged**: C1-00 to C1-09 (PRs #49 to #62) and the Colo fix PRs #63 to #78 (decisions 0131 to 0134). Still open in C1: **C1-10**, the owner's run on the node (first ranger, no degradation of the node's other services); the C1-01 leftovers (clock seams for three flaky tests, and two files over the soft cap; see worknotes P1-C1-01 and P1-C1-01b); and the C1 wave review, which runs together with C2's.
2. **C2 (Doors) has started.** C2-00 (contract) and C2-02, C2-04, C2-05 and C2-06 are in progress. C2-01 and C2-03 start once C2-00 merges. C2-07 (integration, public deploy, live run) needs the owner: 0077, DNS, the UniFi forward and the c2-packets section 5.4 questions.
3. **Owner-gated work ships with safe defaults**, as the cards say: invitee issuing behind a flag that defaults off, the Glass delay at 0, the sovereign filter on, and no Caddy rate-limit module. Each ruling is in [worknotes/orchestrator-2026-11-11.md](worknotes/orchestrator-2026-11-11.md).
4. **Still Proposed:** 0077 (invitee auth), which gates C2-01 issuing, C2-07 and C2b login; and 0079 (credit numbers), which gates C4-04 and C4-05.
5. **Next after C2's desktop packets:** the C2 wave review (C2-R1 to C2-R3 from the desktop; C2-R4 after C2-07's desktop step), then C2b-00 and the parts of C2b with no owner block (C2b-01, 03a, 03b, 04).

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

## Open contradictions

- The C3 cards and plan.md disagree on the soak length. Both are listed as O-soak; no packet states a duration as settled.
- [phase0/RESUME.md](../phase0/RESUME.md) still says the campaign retro is pending, but `docs/analysis/phase0/retro/campaign.md` exists.
