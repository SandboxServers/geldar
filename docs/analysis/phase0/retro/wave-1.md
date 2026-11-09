# Wave 1 retro (2026-11-08 to 2026-11-09)

Wave 1 shipped as PR #4: the contract package, the SQL schema, the compose stack behind Velocity, the threat model. Seven packets plus a wave review.

## What it cost

| Unit | Coder passes | Review passes | Notes |
|---|---|---|---|
| P0-00 threat model | 1 + 1 fix | 2 | |
| P0-01 contract | 2 (first ran out of context before committing) + 1 fix | 2 | Haiku trailer on the first commit |
| P0-02 thought schema | 1 + 1 fix | 2 | |
| P0-03 records | 1 + 1 fix | 2 | |
| P0-04 Thinker frames | 1 + 2 fixes (first blocked) | 2 | needed an orchestrator ruling to change the generator |
| P0-05 sql | 1 + 1 fix | 2 | `decision` verdict (skill foreign keys) went to the owner |
| P0-06 compose | 2 (first ran out of context) + 3 fixes | 3 | most expensive packet |
| Wave review | 3 fix passes (one coder ran out of context before committing; the orchestrator committed its staged work) | 3 | |

About 14 coder passes and 15 review passes for 7 packets. A review pass found something in almost every packet.

## What the reviews caught that the checks did not

- Tests that pass for the wrong reason: a substring match that made a "names the property" test pass on any error; SQL assertions that matched catalog text and survived a mutation that reintroduced the bug; a port check that a plain YAML style bypassed. Reviewers that mutated the code, not only read it, found these.
- Spec values that were wrong on the pinned version (gamerule names on 26.1.2), found only because a reviewer asked for evidence from the running stack.
- Claims in docs ahead of the code (the threat model said CI enforced the loopback port rule when nothing did).
- Invented limits that were not in the packet (patterns on names that rejected real Ollama tags).
- An open interface question (`validateThinkerFrame` error scoping) that the packet's schema shape could not satisfy; found at fix time, not at packet-writing time.

## What went wrong in the process

1. **Coders ran out of context before committing** (P0-01, P0-06, wave fix 2). Packets sized at about 40k tokens used 60k to 95k. The work was recoverable only because it was left uncommitted in the worktree.
2. **Reviewers could not write their reports.** `packet-reviewer` has no write tool, so reports came back inline and the orchestrator copied them into the next brief. Several later briefs said "report to <path>" for a file that was never written.
3. **The coder lacked the brief's trailer.** One coder wrote a Haiku co-author line where the brief gave Sonnet; one said it identifies as Haiku. The brief should say the trailer text is fixed and not to alter it.
4. **Windows worktree removal.** `git worktree remove` deregisters a worktree but leaves the directory when `node_modules` locks it; the leftovers had to be deleted by hand. A `cd ../..` from inside a worktree created a worktree in the wrong parent.
5. **Shell mistakes by the orchestrator.** A stray `python -` waited on stdin and hung two scripted commits; git commands in scripts need `</dev/null`.
6. **Briefs repeated information** (the same ten lines of rules in every brief) and the orchestrator copy-pasted fix notes into briefs when the report file did not exist.
7. **Decision records were out of reach for the orchestrator**, so six spec gaps (0023 to 0028) waited until the end of the wave; the owner then asked for them to be written. Spec gaps found during a packet should be written up at the time.
8. **Review depth varies by prompt.** The reviews that ran the SQL in a container or ran the scanner on hostile inputs found real bugs; the ones that only read code found less.

## What to keep

- One fresh reviewer per pass, read-only; `ship` ends the loop; pass 3 `fix` goes to the owner.
- Wave integration branch with `--no-ff` merges; regenerating (not hand-merging) generated files at conflicts.
- Asking for evidence in the report (pasted log lines, mutation proofs).
- The wave review over the whole diff: it found cross-packet drift that no packet review could.
- Decision records for every departure from the spec.

## Actions

| # | Action | Owner | Size |
|---|---|---|---|
| 1 | Give `packet-reviewer` a way to write exactly one file, its report path from the brief (allow `Set-Content` to that path in its instructions), and say in the agent file that the report file is required. | W1-process: `.claude/agents/packet-reviewer.md` | S |
| 2 | Add "commit early, progress note first, WIP commits allowed on the packet branch" to `packet-coder`, and a rule in the `campaign-packet` skill: if a coder's first return has uncommitted work, the continuation coder commits first. Size guideline: aim for packets that use under 50k tokens; split a packet when its estimate is higher. | W1-process: `.claude/agents/packet-coder.md`, `.claude/skills/campaign-packet/SKILL.md` | S |
| 3 | Put a fixed brief template in the `campaign-packet` skill (worktree, packet, report path, exact commit message with trailers, return line, "do not alter the trailers") so briefs stop being re-invented. | W1-process: skill | S |
| 4 | `ship-pr`: Windows notes: `git worktree remove --force`, then delete a leftover directory only after `git worktree list` shows it unregistered; always use absolute paths for `git worktree add`; add `</dev/null` to scripted git calls. | W1-process: `.claude/skills/ship-pr/SKILL.md` | S |
| 5 | Reviewer checklist in the `packet-reviewer` agent: mutate each new test (revert the guarded change) rather than infer; run hostile inputs against new parsers or validators; compare doc claims with enforced behavior; dry-run the merge into the integration branch (`git merge-tree`). | W1-process: agent file | S |
| 6 | Orchestrator rule in the `campaign-packet` skill: when a review or coder finds a spec gap, write the decision record in the same wave (the orchestrator may write records when the owner has said so; otherwise queue them in `RESUME.md` and ask at the next boundary, do not let them pile up). | W1-process: skill | S |
| 7 | Add a repo check that fails when a file under `docs/decisions/` is not listed in `docs/decisions/README.md`. | W1-process: `tools/repo-checks` + test | S |
| 8 | Record in the skill the observed cost per packet (above) so wave planning can use it: P0-06-like packets (compose, live stack) need two coder sessions budgeted. | W1-process: skill | XS |

Actions 1 to 8 are the `W1-process` packet in [work-packets.md](../work-packets.md).
