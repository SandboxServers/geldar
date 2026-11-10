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

Owner decisions are never guessed. Mark them `BlockedDecision` and ask the owner (AskUserQuestion) before dispatching what depends on them. A settled decision gets a record in `docs/decisions/` and its ledger row links it. A spec gap found by a coder or reviewer gets its record in the same wave: the owner has authorised the orchestrator to write `docs/decisions/` records (and their ledger rows) in the same wave, which is the one exception to "never edits outside `docs/analysis/phase0/`"; a decision that needs the owner's choice is queued in `RESUME.md` and asked at the next boundary.

## 2. Packets are prescriptive and self-contained

Size: aim for packets a packet-coder (Haiku) finishes in under **40k working tokens** (the same figure as `work-packets.md` dispatch rule 10); split a packet whose estimate is higher. Observed in wave 2: almost every first coder attempt hit about 90k tokens with nothing committed (about a quarter of agent runs were continuations), so a brief asks for a progress file. The coder skips CLAUDE.md, so each packet **inlines** the rules it needs. Each packet names:

- the exact files to create or change, with code shapes for anything non-obvious and the spec sections it implements;
- the test to add and why it fails when the change is reverted;
- its checks in order (`pnpm lint`, `pnpm typecheck`, `pnpm test`, or `./geldar.ps1 check`);
- versions to pin, when it adds dependencies;
- the branch, worktree name and commit subject.

Observed in wave 1 (coder passes + fixes): P0-00 1+1; P0-01 2+1 (first ran out of context); P0-02 1+1; P0-03 1+1; P0-04 1+2; P0-05 1+1; P0-06 compose 2+3 (the most expensive; budget two coder sessions for live-stack packets); wave review 3 fixes.

Planning rule (owner ruling, wave 3): shape the dependency graph to fan out early. Put first the small packets that unblock parallel work (skeletons, contracts, config, registries, fixtures), each only as large as the parallel packets need to start; then run the independent packets side by side. The wave's packet table names the unblocking packets, what they unblock and the fan-out point; a large packet that blocks others is split before dispatch.

Integration step (fan-out waves): after the parallel packets, one integration coder merges the fan-out branches into the wave branch, owns the shared interface files (for example `view.ts` and the reflex context type, which several packets extend) and wires the pieces together. Parallel packets that must add fields to a shared file say so in the packet table, so the integration coder knows what to reconcile instead of every coder editing the same file. Keep a coder brief to about 12 items; split a larger one.

Waves hold about four to six packets that one reviewer can hold at once. A wave usually ships as one PR from an integration branch, or one PR per packet when they are independent.

## 3. Dispatch a wave

1. Create the wave's integration branch from `main` (`phase0/wave<N>`) and push it. Each packet gets its own worktree from that branch: the brief names the path, and the coder creates it with `git worktree add <path> -b <packet branch> origin/phase0/wave<N>` (`ship-pr` skill § 1 has the same steps). Coders never share the wave worktree. Merge each packet branch into the wave branch with `git merge --no-ff` once its review says `ship`; packets that build on another branch from the wave branch after that merge.
2. Dispatch every independent packet of the wave in one message, in the background, each with the brief template below (under about 25 lines).
3. On each return, update the ledger row. Open the report only on `blocked`, `failed` or a `decision` verdict.

Coder brief template (fill the angle-bracket fields; copy the rest unchanged):

```
Worktree: <absolute path; the coder creates it with `git worktree add <path> -b <branch> <start>` if it does not exist>
Packet: docs/analysis/<campaign>/work-packets.md, section "### <packet id>" (read it; do not paste it)
Report: <worktree>\.claude\reports\<campaign>\<packet>-<role>.md (role coder, review-<N>, fix-<N>); write it before you return
Live lane: <none | you are the only live user>
Budget: about 35 tool calls; commit each item as it passes; near the cap, commit what passes and report what remains
Commit message (exact, with trailers; do not alter the trailer lines):
  <subject>
  <attribution trailer lines, verbatim>
Return one line: <packet> <done|blocked|failed> <commit-sha|-> <report-path>
```

Live lane: the default is `none` (the coder writes `live: pending`); name `you are the only live user` only for the one coder the orchestrator lets use the live lane.

Trailer lines: copy the attribution text from the session's attribution instruction; never retype it from memory.

Reviewer brief template (a fresh `packet-reviewer`, read-only):

```
Worktree: <absolute path to the worktree>
Scope: <packet id, wave N or campaign>; commit range <base>..<head>
Spec: docs/analysis/<campaign>/work-packets.md, section "### <packet id>" (or docs/spec.md sections <list>)
Pass: <N> of <L> (L = 3 for a single packet, 5 for a batch)
Area: <docs | code, CI and security> (wave reviews only)
Integration branch: <origin/phase0/wave<N>, for the merge-tree check>
Report: <worktree>\.claude\reports\<campaign>\<scope>-review-<N>.md (three sections: Findings, Fix notes, Verdict)
Return one line: <scope> verdict=<ship|fix|decision> <report-path>
```

Fix coder brief ("Review fix, pass N of <L>"): the worktree, the packet section, the input report path (the reviewer's report; it applies only its `## Fix notes`), the commit message and the coder return line above. Continuation coder brief ("continuation N of 3"): the same fields, plus the input report path (the coder's own report, which records the base sha).

A continuation coder ("continuation N of 3") first commits any uncommitted work in the worktree (a WIP commit, squashed into the final commit as the packet-coder rules say), then continues from its report.

Brief template additions: never weaken an assertion or change a fixture to make a test pass (report a Body finding); probes against the server use read-only verbs only; check every parser or fixture of a server reply against a captured real reply; no live lane or Docker unless the brief names the coder as the only live user. Live cases start their own Mind and Body: a brief never has anyone run `adam up` (or `adam up --help`) before them, since it holds port 7410; the live cases are 8B-only, and the 32B run is one manual `adam up --model strong` with no live cases. `adam select` rewrites `shards/phase0.yaml`: restore the committed file before any commit or merge. The orchestrator owns the live lane and runs it serially (one shard: `bench` and `test:live` mutate it); a brief may name exactly one coder as the only live user for that packet; otherwise coders write `live: pending` in their report (live tests are written but not run; the orchestrator runs them). A benchmark failure is a finding, not something to tune away; a hidden control scenario (`bed-clear`) keeps an honest scenario honest.

Retry and cap rule (every coder brief): a packet that adds a retry, a requeue or a cap says what happens at the cap (dead letter, fatal, drop) and requires a test for the last allowed attempt; copy that sentence into the brief when the packet does.

Diagnostics first (live failures): coders cannot run live tests, so a failing live case is not fixed by guessing. First change the case so its failure message prints the state it depends on (inventory, position, time, health, the server reply), have the orchestrator run it, and only then change behaviour. One diagnostic round is cheaper than three blind fixes.

Flaky tests: a test that fails once in any check, even if it passes on rerun, is recorded the same day (worknote or ledger) and gets a fix item in the current wave, not at wave end.

Never keep an agent alive with messages or resume a finished one: follow-ups go to a fresh agent with the report as input.

## 4. Review loops, then ship

| Loop | When | Scope |
|---|---|---|
| Packet | only when the owner asks; by default packets are not reviewed one by one | the packet's commit range |
| Wave | when every packet of the wave has `ship` (waves of two or more) | the wave together: contract drift between packets, duplicated code, two packets editing one file |
| Campaign | after the last wave merges | everything the campaign merged: docs that no longer match, decisions with nothing behind them |

Owner ruling (wave 3): reviews and live runs happen once per wave, at the end (wave close step 0), not per packet or batch. The wave review gets up to 5 rounds with a fix round between them. A single packet that is reviewed on request gets up to 3 passes. Parallel packets can be reviewed as one **batch** (dispatch rule 11): merge them into a temporary branch `phase0/wave<N>-batch-<name>`, review that, and allow up to 5 rounds, then a `decision` ruling. A wave review is split by area (docs; code, CI and security), one reviewer each. Each pass is a fresh `packet-reviewer`. `ship` ends the loop. `fix` before pass L goes to a fresh `packet-coder` ("Review fix, pass N of <L>", the report path; it applies only the `## Fix notes`), then a fresh reviewer for pass N+1. `fix` on pass L, or `decision` on any pass, goes to a ruling: the main session (Opus) decides re-spec, re-slice, accept with a follow-up packet, or ask the owner, and writes it to `worknotes/<packet>.md`. Opus rules; it does not implement packets.

The orchestrator, not the reviewer, records each review round's findings in `worknotes/wave<N>-review-<r>.md` with an owner per item (fix coder, docs, process packet, owner decision). A fix coder's brief gives the path of that file (or the reviewer report) and the items it owns.

A coder that stops on context gets a fresh coder that continues from its report ("continuation N of 3"). After 3 sessions, re-slice the packet.

Then ship with the `ship-pr` skill (§ 8 for the wave PR) and update the ledger rows.

## 5. State on disk

At every wave boundary rewrite `RESUME.md` and the ledger rows. The transcript is not the record: a compaction or a new session must be able to continue from the campaign folder alone.

## 6. Wave close

Every wave ends with the wave close in `work-packets.md` § Wave close, in this order: (0) the wave test and ONE thorough wave review, split by area, up to 5 rounds with a fix round between them, after the last feature packet; (1) a docs sweep by a fresh `packet-coder`, from a list the wave reviewer writes; (2) the retro, `retro/wave-<N>.md`, with numbered Actions, each with an owner and a size; (3) a `W<N>-process` packet that applies the Actions that change the process or the agent and skill scaffolding, reviewed like any packet and merged into the wave branch; (4) the ledger: `README.md` records the retro and the process packet, and `RESUME.md` names the next wave; (5) remove the packet worktrees after copying useful reports to `worknotes/` (`ship-pr` § 7).
