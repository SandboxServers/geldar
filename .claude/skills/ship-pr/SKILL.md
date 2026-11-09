---
name: ship-pr
description: 'Take a change in Geldar from a fresh worktree to a merged PR and a removed worktree. Use when starting a packet or fix that will become a PR, when committing, pushing or opening a PR, waiting on CI, getting a review, merging, or cleaning up after merge. Triggers include "open a PR", "ship it", "push this", "wait for CI", "merge #12", "is CI green".'
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

## 6. Merge

Merge only when `ci gate` is green, the review says `ship`, and the owner asked for the merge (or the campaign's dispatch authorizes merges):

```powershell
gh pr merge <PR> --merge --delete-branch
```

Never use `--admin` to merge around a red or missing check.

## 7. Remove the worktree the same day

```powershell
cd <repo root>
git worktree remove --force .claude/worktrees/<name>
git branch -D <branch>      # only after the PR merged
```

Never run `git worktree prune`, and never remove a worktree a running agent is still using. Copy anything worth keeping from `.claude/reports/` in that worktree to the campaign's `worknotes/` first.

## 8. Windows notes

- `git worktree remove --force` deregisters a worktree, but a `node_modules` lock can leave its directory behind. Delete a leftover directory by hand only after `git worktree list` no longer shows it.
- Always pass `git worktree add` an absolute path. From inside a worktree, a `cd ../..` can put the next worktree in the wrong parent.
- Scripted git calls must not wait on stdin. From Bash add `</dev/null`; from PowerShell, where `<` redirection does not exist, pipe an empty string (`'' | git ...`).
