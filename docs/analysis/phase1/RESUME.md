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
- **Decision numbers:** [packets/decision-number-registry.md](packets/decision-number-registry.md). Phase 1 blocks reserve 0081 to 0129; the next free number is 0130.

## Order to start

1. **Owner confirmations before any wave packet that needs them.** Decisions 0076 (backup scope and destination), 0077 (invitee auth), 0078 (Mind placement), 0079 (credit numbers), and 0080 (NATS auth cutover) are Proposed. Also needed: a deploy account with Docker on the node; the backup destination and how the encryption key is held; a telemetry endpoint (none exists yet, so C1-07 stays off until one is named); and the soak ruling, O-soak (plan.md C3 says seven days; the C3 and C4 cards propose a 72-hour gate at C3 plus one 7-day exit run; the owner picks one in writing).
2. **P1-C1-00 (ledger id C1-00)**, the contract unblocker. It merges first. Fan-out packets never edit `contract/`.
3. **Lanes.** Fan out per the wave's lane table after the unblocker merges. Lanes share files only where a card says so; the shared-file owners are in packet-conventions section 3.

Do not start a wave's live steps until its owner items are answered.

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
