# BLD-19 worknotes

- Branch `phase1/bld-19-leak-tests` from `building/integration` (84d91d5c). The packet names `phase1/bld-19-seen-fence`; the brief names this branch and commit message, and the brief wins.
- `golem/src/building/seen/leak.test.ts`: a world with a stone wall across the cone, a block behind it, a sealed cave and an unloaded chunk in front of the wall. The map and the `surveyBox` reply hold none of the hidden names; hidden cells read unknown. A control cell in front of the wall proves the sweep ran.
- `tools/repo-checks/src/seen-fence.ts` (+ test): `eventsink/`, `telemetry/`, `glass/` never name `building/seen`, `geldar-seen` or `SEEN_BUCKET`. The scan reads every `.ts` file, tests and comments included.
- `tools/repo-checks/src/plan-activity-fence.ts` (+ test): `animus/`, `golem/`, `player-core/`, `threshold/mcp/` never name `plan-activity`, import a Glass `kino` module, or spell the Glass feed subject `geldar.<shard>.kino.<agent>.feed`.
- The NATS ACL test `threshold/mcp/test/nats-auth.it.test.ts` names the feed subject 3 times as data (the permission matrix: only the kino role subscribes). `FEED_SUBJECT_ACL_TESTS` allows exactly those 3 feed-subject lines; any other occurrence fails.
- Both fences are registered by their test files: vitest picks up `tools/repo-checks/src/*.test.ts`, the same way as `ledger-core-purity.test.ts`. No registry edit outside the row.
