# 0220. Merge queue for main

- Status: Proposed
- Date: 2026-11-14
- Spec: none; repo process (numbers 0220 and up are reserved for repo-process decisions)

## Decision

`main` gets GitHub's merge queue, configured as a repository ruleset named "main merge queue" (the exact JSON is in
[docs/runbooks/merge-queue.md](../runbooks/merge-queue.md)). A PR is added to the queue instead of being merged by
hand after `main` moves. The queue builds each entry on a temporary merge of `main` and the entries ahead of it, and
merges the group only if `ci gate` passes on that merge. The workflow side is in `.github/workflows/ci.yml`: it
runs on `merge_group` with the `checks_requested` type, so `ci gate` exists for queue entries. The classic branch
protection that requires `ci gate` stays in place until the ruleset is verified, then it is removed so the two sets
of rules do not both apply.

## Why

Sessions were re-merging `main` into their branches by hand before each merge, which costs a round of CI per PR and
often races with another merge. The queue runs the checks against the state that will actually land, and it merges
a group of passing entries with one run instead of one run per PR.

The queue does not change what runs. The checks are the same jobs, and `ci gate` still passes only when every job
passed. Required checks on the queue's temporary merges are what make the "up to date" rule unnecessary, so the
ruleset sets no strict-up-to-date requirement.

## Consequences

- A merge to `main` from the queue is a push to `main`. The `colo-images` workflow runs on that push for a change
  under its paths, and `colo-deploy` then deploys the Colo node. No human step sits between the merge and the deploy.
  A PR that changes the Colo's code therefore deploys soon after it merges. Amendment 2026-11-14 (owner ruling):
  there are no deploy windows. Deploying PRs are queued as soon as they are ready; merges that land close together
  give one deploy because the queue groups entries and `colo-deploy` keeps only the newest pending run. The one
  exception is a PR with a manual node step (the deploy's `needs manual` items), which is queued only after its
  author has told the orchestrator.
- A PR that conflicts with `main` is dropped from the queue. Its author resolves the conflict and re-queues.
- `colo-images`, `mcp-mock-image` and the other non-required workflows get no `merge_group` trigger. Nothing
  required depends on them at queue time, so they keep their push and pull_request triggers only. Their image tests
  run on the PR, and the publish runs on the push to `main` after the merge.
- The GitHub setting is outside the repo. Enabling the ruleset is an owner or orchestrator action, and rolling it
  back is disabling it.

## Alternatives

- Keep manual merges (merge main in, re-run CI, merge). This is the status quo. It costs a CI run per PR and does
  not stop two PRs that each pass alone from breaking `main` together.
- A bot that merges PRs when they pass (for example a label-driven auto-merge). It needs a token with write access
  to `main` and gives no batching of checks, so the queue is preferred. The ruleset is native to GitHub and needs
  no extra credentials.
