# FLAKE: timing-sensitive tests

Branch `fix/flaky-tests` from `phase0/integration`. Worktree `.claude/worktrees/fix-flake`.

## Status

| # | File | Cause (by reading) | Change | Commit | Mutation check | 5x run | Parallel suite |
|---|------|--------------------|--------|--------|----------------|--------|----------------|
| 1 | golem/src/test-control.test.ts | whole-tree scan under 5 s default timeout | 30 s timeout on the three tree scans | e06509c | done: planted forbidden import fails 2 tests; 1 ms timeout fails 3 | 26/26 each run (5 runs) | golem non-live files pass (see below) |
| 2 | glass/test/import-graph.test.ts | two sync tree scans; vitest times sync tests out too (probe: 6.5 s busy test fails at 5000 ms) | 30 s timeout on both scans | b1b1349 | done: planted nats import fails 1; 1 ms fails 2 | 5/5 each run (5 runs) | glass 148 passed, 7 skipped |
| 3 | threshold/mcp/src/imports.test.ts | cold first import of animus sources (no tree walk) | 30 s timeout on the 8 import tests | 6d4f3f5 | done: bad path fails 1; 1 ms fails 8 | 8/8 each run (5 runs) | threshold/mcp 621 passed, 37 skipped |
| 4 | lantern-local/test/thinker.test.ts (+ thinker.fakes.ts helper) | reconnect tests dial fixed port 1; drain test sleeps 400 ms, asserts with Date.now(); until deadline 3 s | refusedWsUrl() (bound then released ephemeral port); until 10 s on reconnect waits; drain test asserts the 990 ms lower bound, no fixed sleep | 0481abf (lint sort 8624a57) | done: drain delay ignored fails 1 test | 14/14 each run (5 runs) | lantern-local 63 passed, 1 skipped |
| 5 | golem/test/live/adam-stack.test.ts | 600 ms ready bound: the Body's own ready wait shares it, so a slow Body fails the test naming the wrong process | READY_BOUND_MS 5000 with a 15 s test timeout; message regex built from the bound | d99c710 | done: awaits wait removed fails 1 test | 22/22 each run (5 runs) | see below |
| 6 | tools/repo-checks/src/cli.test.ts | 16 cases each run git and a Node child synchronously; 5 s default | 30 s timeout on every case (CLI_TEST_MS) | 21aa873 | done: exit code forced to 0 fails 11 of 16 (restored, diff empty) | 16/16 each run (5 runs) | repo-checks 135 passed |
| 7 | tools/mcp-tokens (typecheck, not a timing flake) | pepper-digest.test.ts used Uint8Array.equals; package had no typecheck script and tsconfig skipped test/ | Buffer.compare in 3 assertions; typecheck script; tsconfig includes test | dc6b608 | not applicable: type and wiring change only, no behaviour changed | 7/7 each run (5 runs) | typecheck passes |

Parallel suite notes:
- golem: `pnpm -C golem exec vitest run` (all files, including test/live) gave 1222 passed, 69 failed, 13 skipped. The 21 failing files are all under `test/live/` and fail on `compose/secrets/rcon.txt does not exist` (run `./geldar.ps1 shard secrets phase0`). No stack was started. The check's own golem step does not run them, and it passes.

## Check

`./geldar.ps1 check` on 8624a57: passed (exit 0). Typecheck, repo checks, generated code, lint and tests (367 files, 4042 tests passed, 64 skipped).
The first check run stopped at biome lint on lantern-local/test/thinker.fakes.ts (import names not sorted, from 0481abf). It was fixed in 8624a57 by a safe biome fix on that one file.

## Remaining

None of the five timing packets is left open. The row 5 parallel result is covered by the golem notes above.
