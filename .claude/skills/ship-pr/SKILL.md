---
name: ship-pr
description: 'Take a change in Geldar from a fresh worktree to a merged PR and a removed worktree. Use when starting a packet or fix that will become a PR, when committing, pushing or opening a PR, waiting on CI, getting a review, asking for or waiting on a human approval in Discord, merging, or cleaning up after merge. Triggers include "open a PR", "ship it", "push this", "wait for CI", "merge #12", "is CI green", "ask for review", "is it approved".'
---

# Ship a PR

Ported from Cimmeria's `ship-pr`, without its build lane and merge queue: Geldar ships with plain `git` and `gh`. Run commands from PowerShell 7.

## 1. Start in your own worktree

```powershell
git fetch origin
git worktree add <absolute path to the repo>\.claude\worktrees\<name> -b <branch> origin/main   # e.g. fix/caps-message caps-fix
cd .claude/worktrees/<name>; ./geldar.ps1 setup                    # pnpm install with the pinned pnpm
```

A campaign packet branches from its wave's integration branch instead of `origin/main` (for example `origin/phase0/wave1`), as its packet section says. Run pnpm as `./geldar.ps1 pnpm <args>` when `pnpm` isn't on PATH.

One worktree per worker; never two implementers in one checkout. Branch names: `phase0/<packet>-<slug>` for campaign packets, `feat/`, `fix/`, `docs/`, `chore/` otherwise. Never commit to `main` directly: it is protected.

## 2. Before you push

- `./geldar.ps1 check` passes. It runs what CI runs, except jobs whose tools you lack locally (say which in the PR).
- A behavior change has a test that fails when the change is reverted.
- Contract changes were made in `contract/` and regenerated.
- New versions are pinned exactly (CLAUDE.md § Repo rules).
- A settled open decision has a record in `docs/decisions/`; a campaign packet's ledger row is updated by the orchestrator, not the coder.
- Facts learned along the way go in `.claude/agent-memory/main-session/` with this change.

## 3. Push and open the PR

```powershell
git push -u origin <branch>
gh pr create --base main --title "<type>(<area>): <what>" --body-file <body.md>
```

The body follows `.github/pull_request_template.md` and ends with the harness's attribution footer. Write the body to a file in your scratch directory, not the repo.

## 4. Wait for CI without polling

Never loop `sleep` around `gh pr checks`. Block on one call (as a background task when the harness supports it), then read the verdict:

```powershell
gh pr checks <PR> --watch --fail-fast
gh pr checks <PR> --required
```

CI is green when `ci gate`, the one check `main` requires, passes. If the second call says `no required checks reported`, `ci gate` hasn't run yet: rerun the first call without `--fail-fast`.

## 5. Review

For a campaign packet, its `packet-reviewer` loop is the review (campaign-packet skill § 4). Otherwise launch a fresh, read-only `packet-reviewer` that did not write the code, with the PR's `base..head` range and the spec sections it implements. Fix its findings with a new commit, push, and wait for CI again.

### Human approval in Discord

A PR into `main` also needs a human approval for its current head, unless the owner says this one does not ([decision 0445](../../../docs/decisions/0445-human-approval-in-discord-before-merge.md)). A campaign packet merging into its wave branch does not; the wave PR (§ 8) does. Read the [Discord workflow](../../../docs/agents/discord-workflow.md) first.

1. Ask once `ci gate` is green on the current head and the review says `ship`. Post the review request with the bridge's `send_message`: tag the reviewer the owner named (ask once if they named none), and include the PR link and the full 40-character head SHA from `gh pr view <PR> --json headRefOid --jq .headRefOid`. The owner's request to ship the PR covers one review request for each head of that PR, so a new head after a fix needs no new permission. Every other post still needs their say-so.
2. Wait for the approval the way § 4 waits for CI: block on one call (as a background task when the harness supports it), with the message ID `send_message` returned and the PR number. Never poll reactions by hand.

   ```powershell
   node tools/discord-bridge/wait-approval.mjs <message ID> --pr <PR>
   ```

   | Exit | Meaning | Next |
   |---|---|---|
   | 0 | A rostered reviewer approved the head in the output | Step 3, after checking that `head` is still your PR's head |
   | 2 | Still waiting when the timeout passed (25 minutes by default) | Run the same call again |
   | 3 | The PR head changed | Wait for CI (§ 4), then post a new request for the new head |
   | 4 | The PR was closed or merged | Stop |
   | 1 | The check could not run | Read the message; usually the token, the roster or `gh` |

   The default timeout fits inside a 30-minute background task. To be woken less often, raise both: `--timeout 110` inside a two-hour task. A session that was interrupted checks where things stand with `--once`.
3. Record the approval on the PR, so GitHub shows what was approved and where: `gh pr comment <PR> --body "Approved in Discord for <head SHA>: <link to the review request>"`. Leave account names and IDs out; the repo is public.

## 6. Merge

Merge only when `ci gate` is green, the review says `ship`, a PR into `main` has its human approval for the current head (§ 5), and the owner asked for the merge (or the campaign's dispatch authorizes merges):

```powershell
gh pr merge <PR> --merge --delete-branch
```

Never use `--admin` to merge around a red or missing check.

## 7. Remove the worktree after merge

```powershell
cd <repo root>
git worktree remove --force .claude/worktrees/<name>
git branch -D <branch>      # only after the PR merged
```

Never run `git worktree prune`, and never remove a worktree a running agent is still using. `--force` discards uncommitted and untracked work, which the plain command refuses to do: run `git -C <worktree> status --short` first, and commit or copy whatever it lists. Copy anything worth keeping from `.claude/reports/` in that worktree to the campaign's `worknotes/` first.

## 8. Wave PR (integration branch to main)

1. Merge `origin/main` into the wave branch first. Never hand-merge `pnpm-lock.yaml`: take either side, run `./geldar.ps1 pnpm install` and commit the regenerated lockfile.
2. Push, open the PR with base `main`, and wait for `ci gate` (§ 4).
3. Merge only if the wave's exit criteria are met and the owner has authorised it (§ 6).

## 9. Windows notes

- `git worktree remove --force` deregisters a worktree, but a `node_modules` lock can leave its directory behind. Delete a leftover directory by hand only after `git worktree list` no longer shows it.
- A bare `--` before a path breaks `geldar.ps1` parameter binding (ten runs failed silently): pass the path without it.
- Always pass `git worktree add` an absolute path. From inside a worktree, a `cd ../..` can put the next worktree in the wrong parent.
- Scripted git calls must not wait on stdin. From Bash add `</dev/null`; from PowerShell, where `<` redirection does not exist, pipe an empty string (`'' | git ...`).
