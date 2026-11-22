# BLD-30 worknote

Status: Done (docs only; checks pass)
Branch: phase1/bld-30-runbook
Worktree: C:\Users\Steve\source\projects\geldar-wt-bld-30
Base sha: 35fa5207 (building/integration; no origin/building/integration exists, so the local branch was used)
Commit: see the coder report
Checks: `./geldar.ps1 pnpm check:repo` ok (no revert check: docs only, no behaviour change)
Revert check (test that failed): n/a
Live: pending
Notes:
- Added `docs/runbooks/building.md` and one index row in `docs/runbooks/README.md`.
- Covers the flag `body_actions.building` and its off state, rollback by config and restart, what turning it off does
  not do, no restore (0130), BlueMap and CoreProtect views from outside the world, windows R1 to R3, the NATS role and
  bucket MANUAL steps, the accepted risks of 0422, and kit upgrade lag.
- Named but not verified on this branch: `golem/src/seed-buckets.ts` and `golem/src/building/names.ts`; the index row
  is marked `references checked: no` for this reason.
- No secrets, account names, IPs or hostnames.
