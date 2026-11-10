# Phase 1 packet conventions

Status as of 2026-11-10, branch `docs/phase1-analysis`. These rules apply to every Phase 1 packet. They follow from the Phase 0 evidence in [phase0-retrospective-for-phase1.md](phase0-retrospective-for-phase1.md) (section 6 lists the rules with their evidence). The plan is [plan.md](plan.md); the decisions are in the [decisions index](../../decisions/README.md).

## 1. Card format

Every packet is a card in the wave plan with these fields, in this order:

| Field | Rule |
|---|---|
| `id` | `C<wave>-<nn>`, for example `C1-03`. Waves: C1, C2, C2b, C3, C4 (plan.md), plus the campaign boundary. |
| `wave` | The wave the packet belongs to. |
| `depends-on` | Packet ids that must be merged first. Contract-first unblockers come first (section 2). |
| `may-edit` | An explicit list of files and directories. Anything not listed is out of scope. |
| `must-not-edit` | Always includes `docs/spec.md`, and the shared files in section 3 unless the card owns them. |
| `decisions` | The decision numbers reserved for the packet (section 7). A coder uses only numbers in this list. |
| `checks` | The targeted commands and the gates in section 4 that apply. |
| `size` | Working-token budget: about 40k working tokens, 40 to 60 tool uses. |
| `worknote` | One path per packet: `docs/analysis/phase1/worknotes/<id>.md`. Append as you go. One file per packet, so there are no add/add conflicts. |
| `commit` | Commit per item, with a subject that names the item. |
| `on-cap` | "Commit what passes and report the rest": a packet that hits its budget commits the passing items, writes the rest into its worknote and report, and stops. |

Packets that touch compose or live stacks get two sessions. A packet that needs a split file (over 500 lines) splits it first, in its own commit.

## 2. Contract-first ordering

1. A small **unblocker** packet changes `contract/` (the schema) and runs the generator. It is the only packet in its wave that touches `contract/` and its generated output. It merges before fan-out starts.
2. Fan-out packets never edit `contract/`. If a fan-out packet needs a new field or shape, it writes an "index line to add" request in its worknote, and the unblocker or the integration packet makes the change.
3. Generated code is never edited by hand. It is regenerated from `contract/`.
4. A fan-out packet starts only after its `depends-on` unblocker is merged to the wave branch.

Reason: the Phase 0 shared-file collisions and the wave 4 integration coder (retro/wave-4.md line 31).

## 3. Shared-file ownership

Shared files have one owner per wave. A packet that needs a change it does not own writes an "index line to add" in its worknote, and the owner applies it.

| Shared file | Owner | Handoff |
|---|---|---|
| `docs/decisions/README.md` | Ops merge step. The index is regenerated or checked at merge. | "Index line to add" in the worknote: the number, title, status and file name. |
| Campaign ledger README ([docs/analysis/phase0/README.md](../phase0/README.md) for Phase 0; the Phase 1 ledger when written) | Ops merge step | Same as above; packets never edit the ledger rows of other packets. |
| `geldar.ps1` | The integration packet named in the wave plan | "Index line to add" with the command and its help text. |
| Repo-checks registry (`tools/*/repo-checks`) | The integration packet named in the wave plan | Same. |
| `compose/phase0.yml` and any new compose file | The integration packet for the wave. A new compose file is created by the packet that needs it, then listed here. | Same. Budget two sessions for compose work. |
| `shards/phase0.yaml` (and any new shard config) | The integration packet for the wave | Same. |
| `contract/` and its generated output | The contract-first unblocker (section 2) | Fan-out packets request changes; they never edit. |
| Golem `view.ts` | The integration packet for the wave | Same. |
| `package.json` and the lockfile | The one packet named in its card, one at a time per wave. Other packets request via "index line to add". Versions are pinned with `pnpm add -E`. | Same. |

## 4. Gates

### 4.1 Per packet

Each packet runs these before its last commit:

1. Targeted tests for the packet's behaviour, named on the card.
2. Typecheck and Biome (`pnpm format`) of the touched package, through `./geldar.ps1 pnpm`.
3. The revert-check: revert the behaviour change locally, run the targeted test, confirm it fails, restore the change. The report says which test was reverted.
4. The file-size cap: 700 lines hard, 500 soft (the repo rule in the project guidance).
5. The decision-index check: every new record has a row in the index, and its number is in the packet's reserved block.
6. A `git merge-tree` dry run against the wave branch, to find conflicts before the merge.

### 4.2 Per wave boundary

1. Full `./geldar.ps1 check`, with the integration case-count floor. Reason: CI skipped 43 integration tests in Phase 0.
2. One read-only review per surface, with a narrow brief. The next round aims only at the fixes.
3. One live run with a real client (not a mock), recorded in the worknote.
4. The wave retro, written in `retro/`.
5. Provisional decisions from the wave get an owner confirmation or a superseding record.

### 4.3 Per campaign boundary

1. An adversarial campaign review, by reviewers who did not write the code.
2. A full soak and chaos run.
3. A security review of every public surface (the MCP endpoint, Glass, the Lakitu feed, the Minecraft port, NATS).

## 5. Parallelism and rules for briefs

- At most about six agents at once. Reason: the Phase 0 machine limit (RESUME.md machine line).
- One git worktree per packet, under `.claude/worktrees/`. Never share a worktree between packets.
- Every brief gives the absolute worktree path. Reason: wrong-worktree edits in waves 3 and 5.
- Every brief has the never-do list:
  - no `adam up`, and no `adam up --help` on a live node;
  - no state-changing probes against a live shard;
  - never weaken a test, fixture or verdict to make it pass;
  - never `git reset`, `git stash` or `git checkout` on tracked work;
  - never edit `docs/spec.md`;
  - never push, open a PR, or prune a worktree.
- The orchestrator writes no code. Ops does merges, checks and live runs. Reason: the Phase 0 hand-patching ruling.
- Databases and secrets come through an environment variable, not a junction.
- Flaky tests: use injected clocks, keep a flake log, and never retry-until-green.

## 6. Decision-number registry

Each packet uses only numbers in its block. The orchestrator reserves the block when it writes the wave plan. Gaps are fine (the decisions README says so).

| Block | Numbers | Use |
|---|---|---|
| Pre-packet | 0076 to 0080 | The five decisions that must be settled before any packet starts (section 8) |
| C1 | 0081 to 0089 | Wave C1 |
| C2 | 0090 to 0099 | Wave C2 |
| C2b | 0100 to 0104 | Wave C2b (Lakitu and Glass) |
| C3 | 0105 to 0114 | Wave C3 |
| C4 | 0115 to 0129 | Wave C4 (Shrine, birth, life IDs) |

A coder checks `docs/decisions/` before it commits, and uses the next free number in its own block. A record never reuses a number.

## 7. Index lines

A packet that adds a record does not edit the index itself unless its card owns the index. It writes the index line in its worknote in this form:

```
index: | [NNNN](NNNN-slug.md) | Title | Status |
```

The ops merge step adds the line in number order. This keeps the index out of most merge conflicts (the Phase 0 hotspot, section 5.2 of the retrospective).

## 8. Pre-packet decisions

Five records are proposed before the packets are written, as 0076 to 0080. Each needs the owner's confirmation before a packet depends on it:

- [0076](../../decisions/0076-backup-scope-and-destination.md): backup scope and destination
- [0077](../../decisions/0077-invitee-auth-and-the-0072-0075-login-rule.md): invitee auth and the login rule for cameras
- [0078](../../decisions/0078-mind-placement-for-phase1.md): where the Mind runs in Phase 1
- [0079](../../decisions/0079-credit-numbers-and-charge-rules.md): credit numbers and charge rules
- [0080](../../decisions/0080-nats-auth-cutover.md): NATS auth cutover

## 9. Gate evidence in the report

The report of each packet lists, for each gate in section 4.1: the command, its final result, and the commit hash. A gate that did not run is listed as not run, with the reason.
