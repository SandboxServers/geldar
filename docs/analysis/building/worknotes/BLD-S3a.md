# BLD-S3a worknote

Status: Done (body scaffold in place, flag off). Stubs throw `not_implemented`, or return null for the lane hook.
Branch: phase1/bld-s3a-body
Worktree: C:\Users\Steve\source\projects\geldar-wt-bld-s3a
Base sha: 0468c634055e4ce4d23193f1de316e4cdab2f966
Commit: see the report
Checks: lint (no new findings in the touched files), golem typecheck clean, targeted golem tests 83 of 83 pass.

Break and plan are registered in the Body action list. With `body_actions.building` off they refuse with `BUILDING_REFUSAL`. With the flag on they reach their stubs and throw `not_implemented`.

Deferred (see the coder report): the adam-config `building` key, the shard files, the restart and wake hooks, the metrics re-export, the seed-buckets lines and the erase coverage list.
