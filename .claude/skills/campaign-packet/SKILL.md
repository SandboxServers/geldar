---
name: campaign-packet
description: Run a multi-PR effort in Geldar (Phase 0 first) as a campaign of prescriptive work packets - the session writes or updates the ledger and packets, dispatches one packet-coder per packet in its own worktree, runs read-only packet-reviewer loops, and keeps RESUME.md current. Use when the user says "resume Phase 0", "run the next wave", "split this into packets", "dispatch workers", or when writing or reviewing a work-packets.md, RESUME.md, worknote or ledger.
---

# Campaign and work packets

Ported from Cimmeria's `campaign-packet`, trimmed for a small repo: there is no orchestrator-only persona, no `ops` agent, no agent board and no merge queue. The main session orchestrates and may use a shell. Add the heavier machinery when Phase 1 brings many parallel agents.

| Step | Who | Writes |
|---|---|---|
| Ledger, packet slicing, decisions | main session (or a Plan agent for a hard slice) | `README.md`, `work-packets.md`, `RESUME.md` |
| Worktrees, PRs, merge, removal | main session, with the `ship-pr` skill | nothing in the campaign folder |
| One packet in one worktree | `packet-coder` | a local commit and a report |
| Review a packet, a wave or the campaign | fresh `packet-reviewer` (read-only) | a report with numbered fix notes |
| Apply fix notes | fresh `packet-coder` | a fix commit and a report |

## 0. Before acting

Read `docs/analysis/<campaign>/RESUME.md`, then the ledger `README.md`. Open a packet's section in `work-packets.md` only when you dispatch or review it. Check `git worktree list` and recent branches (`git log --all --since="1 hour ago" --oneline`) so you don't collide with another live session. Write the campaign name to `.claude/state/active-campaign` (gitignored).

## 1. The campaign folder

- `README.md` (the ledger): purpose and exit criteria, a **Decisions** table (`D-P0-NN`: status, owner, record link), and a packet table with status **Ready / BlockedDependency / BlockedDecision / Writing / Review / Done**.
- `work-packets.md`: dispatch rules, the shared **contract** packets build against (names, paths, schemas, return formats), then one section per packet grouped into waves.
- `RESUME.md`: at most 40 lines. Current wave, packets in flight with their worktrees, the next action, open decisions.
- `worknotes/`: leftovers from finished packets and ruling notes.

Owner decisions are never guessed. Mark them `BlockedDecision` and ask the owner (AskUserQuestion) before dispatching what depends on them. A settled decision gets a record in `docs/decisions/` and its ledger row links it. A spec gap found by a coder or reviewer gets its record in the same wave: the orchestrator writes records only when the owner has said so; otherwise it queues them in `RESUME.md` and asks at the next boundary, so they do not pile up.

## 2. Packets are prescriptive and self-contained

Size: aim for packets a packet-coder (Haiku) finishes in under **40k working tokens** (the same figure as `work-packets.md` dispatch rule 10); split a packet whose estimate is higher. The coder skips CLAUDE.md, so each packet **inlines** the rules it needs. Each packet names:

- the exact files to create or change, with code shapes for anything non-obvious and the spec sections it implements;
- the test to add and why it fails when the change is reverted;
- its checks in order (`pnpm lint`, `pnpm typecheck`, `pnpm test`, or `./geldar.ps1 check`);
- versions to pin, when it adds dependencies;
- the branch, worktree name and commit subject.

Observed in wave 1 (coder passes + fixes): P0-00 1+1; P0-01 2+1 (first ran out of context); P0-02 1+1; P0-03 1+1; P0-04 1+2; P0-05 1+1; P0-06 compose 2+3 (the most expensive; budget two coder sessions for live-stack packets); wave review 3 fixes.

Waves hold about four to six packets that one reviewer can hold at once. A wave usually ships as one PR from an integration branch, or one PR per packet when they are independent.

## 3. Dispatch a wave

1. Create the wave's integration branch from `main` (`phase0/wave<N>`) and push it. Create one worktree per packet from that branch (`ship-pr` skill § 1, with `origin/phase0/wave<N>` as the start point). Merge each packet branch into the wave branch with `git merge --no-ff` once its review says `ship`; packets that build on another branch from the wave branch after that merge.
2. Dispatch every independent packet of the wave in one message, in the background, each with the brief template below (under about 25 lines).
3. On each return, update the ledger row. Open the report only on `blocked`, `failed` or a `decision` verdict.

Coder brief template (fill the angle-bracket fields; copy the rest unchanged):

```
Worktree: <absolute path to the worktree>
Packet: docs/analysis/<campaign>/work-packets.md, section "### <packet id>" (read it; do not paste it)
Report: <worktree>\.claude\reports\<campaign>\<packet>-<role>.md (role coder, review-<N>, fix-<N>); write it before you return
Commit message (exact, with trailers; do not alter the trailer lines):
  <subject>
  <attribution trailer lines, verbatim>
Return one line: <packet> <done|blocked|failed> <commit-sha|-> <report-path>
```

Trailer lines: copy the attribution text from the session's attribution instruction; never retype it from memory.

Reviewer brief template (a fresh `packet-reviewer`, read-only):

```
Worktree: <absolute path to the worktree>
Scope: <packet id, wave N or campaign>; commit range <base>..<head>
Spec: docs/analysis/<campaign>/work-packets.md, section "### <packet id>" (or docs/spec.md sections <list>)
Pass: <N> of 3
Integration branch: <origin/phase0/wave<N>, for the merge-tree check>
Report: <worktree>\.claude\reports\<campaign>\review-<scope>-<N>.md (three sections: Findings, Fix notes, Verdict)
Return one line: <scope> verdict=<ship|fix|decision> <report-path>
```

Fix coder brief ("review fix, pass N of 3"): the worktree, the packet section, the input report path (the reviewer's report; it applies only its `## Fix notes`), the commit message and the coder return line above. Continuation coder brief ("continuation N of 3"): the same fields, plus the input report path (the coder's own report, which records the base sha).

A continuation coder ("continuation N of 3") first commits any uncommitted work in the worktree (a WIP commit, squashed into the final commit as the packet-coder rules say), then continues from its report.

Never keep an agent alive with messages or resume a finished one: follow-ups go to a fresh agent with the report as input.

## 4. Review loops, then ship

| Loop | When | Scope |
|---|---|---|
| Packet | as soon as its coder returns `done` | the packet's commit range |
| Wave | when every packet of the wave has `ship` (waves of two or more) | the wave together: contract drift between packets, duplicated code, two packets editing one file |
| Campaign | after the last wave merges | everything the campaign merged: docs that no longer match, decisions with nothing behind them |

Each pass is a fresh `packet-reviewer`. `ship` ends the loop. `fix` on pass 1 or 2 goes to a fresh `packet-coder` ("review fix, pass N of 3", the report path; it applies only the `## Fix notes`), then a fresh reviewer for pass N+1. `fix` on pass 3, or `decision` on any pass, goes to a ruling: the main session (Opus) decides re-spec, re-slice, accept with a follow-up packet, or ask the owner, and writes it to `worknotes/<packet>.md`. Opus rules; it does not implement packets.

A coder that stops on context gets a fresh coder that continues from its report ("continuation N of 3"). After 3 sessions, re-slice the packet.

Then ship with the `ship-pr` skill and update the ledger rows.

## 5. State on disk

At every wave boundary rewrite `RESUME.md` and the ledger rows. The transcript is not the record: a compaction or a new session must be able to continue from the campaign folder alone.

## 6. Wave close

Every wave ends with the wave close in `work-packets.md` § Wave close: (1) a docs sweep by a fresh `packet-coder`, from a list the wave reviewer writes; (2) the retro, `retro/wave-<N>.md`, with numbered Actions, each with an owner and a size; (3) a `W<N>-process` packet that applies the Actions that change the process or the agent and skill scaffolding, reviewed like any packet and merged into the wave branch; (4) the ledger: `README.md` records the retro and the process packet, and `RESUME.md` names the next wave.
