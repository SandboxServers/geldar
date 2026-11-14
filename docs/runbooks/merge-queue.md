# Merge queue for main

Decision: [0220](../decisions/0220-merge-queue-for-main.md). The queue is a GitHub repository ruleset on `main`.
It is not set in the repo: the orchestrator creates it once the workflow change that makes `ci gate` run on
queue entries is on `main`. Until then the queue would wait forever for a check that never starts.

## What the queue does here

- A PR is added to the queue with `gh pr merge <n> --merge` (or the Merge button, or "Add to queue"). It is not
  merged directly while the ruleset is active.
- The queue builds each entry on a temporary merge of `main` plus the entries ahead of it, up to 5 at a time.
  The checks run on that temporary merge, so the entry is tested against what `main` will be after it lands.
  No manual "merge main in" is needed, and must not be done: it only adds a CI run.
- When the group's `ci gate` passes, the queue merges the group to `main` with one merge commit per entry
  (merge method MERGE). If the group fails, the failing entry is removed and the rest are rebuilt without it.
- `ci gate` is the only required check. It passes only when every job in `.github/workflows/ci.yml` passed.
  A skipped or failed job fails the gate, as it does for a PR.

## The ruleset

Create it with the JSON below. The `ci gate` context is the plain form the classic protection already uses, with
no `integration_id`. The rules are the ones listed here and no others: no bypass actors, no deletion or
force-push rule added or removed.

Save as a file outside the repo, then:

```
gh api -X POST repos/SandboxServers/geldar/rulesets --input <file>
```

```json
{
  "name": "main merge queue",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["~DEFAULT_BRANCH"],
      "exclude": []
    }
  },
  "bypass_actors": [],
  "rules": [
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["merge", "squash", "rebase"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [
          { "context": "ci gate" }
        ]
      }
    },
    {
      "type": "merge_queue",
      "parameters": {
        "merge_method": "MERGE",
        "grouping_strategy": "ALLGREEN",
        "max_entries_to_build": 5,
        "max_entries_to_merge": 5,
        "min_entries_to_merge": 1,
        "min_entries_to_merge_wait_minutes": 5,
        "check_response_timeout_minutes": 30
      }
    }
  ]
}
```

`strict_required_status_checks_policy` is false because the queue already tests each entry on the merge of
`main`; requiring the branch to be up to date would only force reruns.

Check after creating it:

```
gh api repos/SandboxServers/geldar/rulesets
gh api repos/SandboxServers/geldar/rules/branches/main
```

The second call lists the rules that apply to `main`. It must show `merge_queue`, `pull_request` and
`required_status_checks` from the new ruleset.

## The classic branch protection

`main` has classic branch protection that requires `ci gate`. While the ruleset is new, leave the classic
protection in place. Once the ruleset is verified (a docs-only PR queued and merged through it), remove the classic
rule so that the two sets of rules do not both apply. Before removing it, read its settings:

```
gh api repos/SandboxServers/geldar/branches/main/protection
```

If the classic rule also blocks force pushes or deletion, those protections are not in the JSON above. Keep them by
adding the matching rules to the ruleset first; the orchestrator decides that before the classic rule goes.

## Rollback

Disable the ruleset to stop the queue. Merges go back to the classic protection (if it is still there) or to no
rule (if it was removed). Disable it with:

```
gh api -X PUT repos/SandboxServers/geldar/rulesets/<id> --input <file-with-enforcement-disabled>
```

Here `<file-with-enforcement-disabled>` is the ruleset JSON with `"enforcement": "disabled"`. Deleting the ruleset
(`gh api -X DELETE repos/SandboxServers/geldar/rulesets/<id>`) also works. If the classic rule was removed, put it
back before disabling the ruleset, or `main` has no required check.

The workflow change in `ci.yml` (the `merge_group` trigger) is harmless when the ruleset is off, so it does not
need rolling back.

## Operating rules

These rules keep a deploy from happening at a time nobody chose. Read them before you queue a PR.

(a) Queue anything that does not deploy freely: docs, tests, plugin-only changes, decisions. These are safe to
queue at any time.

(b) A PR that changes a path `colo-images` builds (`.github/workflows/colo-images.yml`: `golem/**`, `animus/**`,
`player-core/**`, `eventsink/**`, `threshold/mcp/**`, `tools/admin/**`, `glass/**`, `threshold/register/**`,
`tools/mcp-tokens/**`, `tools/players-cli/**`, `tools/migrate/**`, `golem/src/players/**`, `sql/**`,
`shards/phase0.yaml`, `tools/repo-checks/src/identity-mode.ts`, `contract/**`, the root `package.json`,
`pnpm-workspace.yaml` and `pnpm-lock.yaml`) deploys the Colo node as soon as it merges. `colo-images` runs on
the push to `main`, and `colo-deploy` runs on its success. Queue such a PR only inside a deploy window the
orchestrator has opened. Outside a window it stays out of the queue.

Several entries queued back to back give one deploy, not one each. `colo-deploy` keeps only one pending run in its
concurrency group, so when merges land close together the newest commit is the one deployed. The window is the
whole batch, not one PR at a time. Check the queued entries before the window opens. A failing entry is removed,
but the entries ahead of it that passed still merge and deploy.

(c) `gh pr merge <n> --merge` adds the PR to the queue when the ruleset requires it. Do not use `--admin` to skip
the queue: the admin bypass is not configured, and it would merge the PR without the queue's check on the merged
state.

(d) A PR that conflicts with `main` is dropped from the queue. The usual conflict is the decisions table in
`docs/decisions/README.md`. The author resolves it as a union of the rows (keep every row from both sides, in
number order), pushes, and queues the PR again. The queue does not resolve conflicts for you.

(e) The checks run again on the queue's temporary merge. No "merge main in" is needed before queueing, and a
branch that is behind `main` is not blocked by it.

(f) A queue entry that fails CI is removed from the queue, and nothing from that entry is merged. The entries
after it are rebuilt without it. Fix the failure on the PR branch and queue it again.

## Known limits

- The queue tests the merged state of the entries it holds. A PR that changes only a path no job covers gets the
  same checks as any other PR: `ci.yml` has no path filter, so every entry runs the whole suite.
- `mcp-mock-image`, `colo-images` and the other non-required workflows do not run on queue entries. They have no
  `merge_group` trigger, and no required check depends on them. Their image tests run on the PR, and their publish
  runs on the push to `main` after the merge.
- The `ci gate` check name and the job names in `ci.yml` are part of the ruleset. Renaming a job breaks the queue
  until the ruleset is updated to match.
