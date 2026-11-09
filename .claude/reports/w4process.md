# w4process report

Base: 251ff8d. Branch phase0/w4-process.

- A1 packet-coder.md: pwd and write-path check, Edit/Write tool and no backtick escapes, `git diff --check` plus `check:repo` (working-tree scan) before the final commit, 12-item brief rule, 80-turn stop.
- A2 tools/repo-checks: working-tree control-character scan (tracked and untracked non-ignored). Tests: clean tree, staged defect (reported once), unstaged, untracked, ignored untracked, CRLF pairs. Revert-check: replacing the working-tree finding with null fails the unstaged and untracked tests; restored with git checkout.
  Deviation: CRLF pairs in the working tree are allowed (a lone CR and other control bytes fail). The existing test "judges the index, not a working tree that autocrlf made CRLF" requires it, and git converts CRLF to LF on add under .gitattributes. The index CRLF check is unchanged.
- A3 campaign-packet SKILL: integration step, diagnostics-first rule, flaky-test same-day rule, 12-item brief.
- A4 run-shard SKILL: "Wave test procedure" (shard up rebuilds images already stated, so not repeated; background live lane, eventsink IT with rebuilt image). body-bench SKILL: pointer and live-test conventions.
- A5 golem/test/live/fixture.ts: `healBot`, `resetBot` (heal, clear effects, time and weather, gamerules, restore function). Used in reflex-combat.live.test.ts (replaces local midnight and healToFull; asserts unchanged) and the two panic-burrow cases of reflex-shelter.live.test.ts. Not applied to eat-sleep, limited-probe, bench (they set time explicitly, or damage inside the bench reset). Not run live: live: pending. golem/README.md has the conventions note.
- A6 packet-reviewer.md: geometry/angle tests, first/last/past-cap attempt tests.
- A7 chosen: commit the reports. .gitignore: `.claude/reports/*` plus `!.claude/reports/w*.md` (a report named w*.md directly in .claude/reports/ is committed; subfolder reports stay local, because git cannot un-ignore inside an ignored directory). packet-coder brief updated to match.