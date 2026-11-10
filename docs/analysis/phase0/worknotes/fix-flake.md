# FLAKE: timing-sensitive tests

Branch `fix/flaky-tests` from `phase0/integration`. Worktree `.claude/worktrees/fix-flake`.

## Status

| # | File | Cause (by reading) | Change | Commit | Mutation check | 5x run | Parallel suite |
|---|------|--------------------|--------|--------|----------------|--------|----------------|
| 1 | golem/src/test-control.test.ts | whole-tree scan under 5 s default timeout | 30 s timeout on the three tree scans | e06509c | done: planted forbidden import fails 2 tests; 1 ms timeout fails 3 | pending | pending |
| 2 | glass/test/import-graph.test.ts | two sync tree scans; vitest times sync tests out too (probe: 6.5 s busy test fails at 5000 ms) | 30 s timeout on both scans | pending | done: planted nats import fails 1; 1 ms fails 2 | pending | pending |
| 3 | threshold/mcp/src/imports.test.ts | cold first import of animus sources (no tree walk) | 30 s timeout on the 8 import tests | pending | done: bad path fails 1; 1 ms fails 8 | pending | pending |

| 4 | lantern-local/test/thinker.test.ts (+ thinker.fakes.ts helper) | reconnect tests dial fixed port 1; drain test sleeps 400 ms, asserts with Date.now(); until deadline 3 s | refusedWsUrl() (bound then released ephemeral port); until 10 s on reconnect waits; drain test asserts the 990 ms lower bound, no fixed sleep | pending | done: drain delay ignored fails 1 test | pending | pending |

Remaining: golem adam-stack 600 ms assertion, repo-checks cli timing, mcp-tokens typecheck.
