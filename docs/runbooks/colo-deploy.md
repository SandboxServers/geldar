# Colo deploy from GitHub Actions (CD-2b)

The workflow `.github/workflows/colo-deploy.yml` deploys the Colo node after the `colo-images` workflow
has published a commit's images. The node runs the deploy from a self-hosted runner. The decision
behind the release manifest is 0084 (`docs/decisions/0084-colo-deploy-by-pull-with-a-project-scoped-script.md`).
The scripts are described in `deploy/README.md`.

## How a deploy runs

1. A push to `main` that changes the images runs `colo-images`. It pushes the images and writes the
   `release.env` artifact. Its run must succeed.
2. `colo-deploy` starts on that run's `workflow_run` event. It runs only when the run succeeded, its
   branch is `main`, its event is `push` or `workflow_dispatch`, and both repositories are this one.
3. The job takes the `colo` environment, which the repository limits to `main`. Its concurrency group
   is `colo-deploy`, with `cancel-in-progress: false`: a second deploy waits for the first. The job
   timeout is 40 minutes.
4. It resolves the commit (the run's head SHA) and the `colo-images` run that built it. The runner
   has no GitHub CLI (`gh`). The steps call the GitHub REST API with `curl` and read the replies with
   `jq`, using the job's `GITHUB_TOKEN`. On a manual dispatch without a SHA, the head of `main` comes
   from `GET /repos/{repo}/commits/main`. The SHA must be on `main`: the compare status of
   `main...<sha>` must be `identical` or `behind`. The successful `colo-images` run for the SHA comes
   from the workflow runs list, and the job fails when there is none.
5. It fetches `release.env` of that run with curl and jq (step timeout 5 minutes; the whole job 30).
   The artifact blob host can time out from the node, so every curl has a 10 s connect and 60 s total
   limit and `--retry 4`, and the archive download is tried 3 times. The zip must match the sha256
   digest the API reports for the artifact; a mismatch fails the job with no fallback. If the artifact
   path fails otherwise (blob timeout, no digest), it reads the same content from the check-run
   annotation titled `release.env` on the `release manifest` job of the `colo-images` run, through
   `api.github.com` (this needs `checks: read`). Both sources are the same run under the same token,
   and step 6 still checks the SHA, the registry prefix and the revision labels. It then writes the file
   to the node's inbox (`/var/lib/geldar-deploy/inbox/release.env`) through a temporary file, so the
   file appears whole, with mode 0600. The logic is in the workflow step and is tested by
   `deploy/test/colo-fetch-manifest.test.ts` (needs bash, jq, unzip or python3).
6. It runs `plan <sha>`, then `deploy <sha>`, through the root-owned entrypoint with
   `sudo -n /usr/local/libexec/geldar-deploy/run`. The entrypoint refuses a SHA that main does not
   contain, validates the manifest, fetches main itself and runs `deploy/colo-cd.sh` from its own
   verified copy. The workflow checks out no code.
7. The job summary shows the commit, the mode, the result, the plan, the deploy log and the
   "needs manual" list.

Nothing is uploaded. The job prints the entrypoint's output, which must never contain a secret.

## Manual dispatch

The operator dispatches from a clone, on the operator's machine (not on the runner, which has no
`gh`), with the GitHub CLI and a token that can run workflows:

```sh
gh workflow run colo-deploy.yml -f sha=<40-hex commit on main>
```

Without `-f sha` the job deploys the head of `main`. The job refuses a commit that is not on
`main` (the compare status must be `ahead` or `identical`). It also refuses a commit with no
successful `colo-images` run, because the images must exist before the node pulls them. Check
the run first with `gh run list --workflow colo-images.yml --branch main`.

## Plan only

```sh
gh workflow run colo-deploy.yml -f sha=<sha> -f plan_only=true
```

The plan step runs, and the deploy step is skipped. The manifest is still written to the inbox,
as the entrypoint's plan reads it from there.

## "needs manual"

The pipeline applies only the Colo images and the stack that `colo-cd.sh` owns. It does not
apply these changes, and an operator must act on them:

- a plugin jar change (the Paper plugin), and the Paper restart that loads it;
- Paper, Velocity, Caddy or NATS configuration or version changes.

The job summary lists the lines that the plan or the deploy printed with the words `needs manual`.
If the list says `None reported`, nothing was flagged. Read the list and the plan output before you
close a deploy. Note: `deploy/colo-cd.sh` is not in this repository yet, so the exact wording it uses
for these lines is unverified here. Update this section when the script lands.

## Maintenance notices

Before the deploy restarts the body or MCP containers, it publishes a maintenance notice on
`geldar.<shard>.maintenance`, and a second notice when the restart is done. The Paper plugin says
one fixed line to the players. The lines, the rules and how to switch broadcasting off are in
`docs/runbooks/maintenance-notice.md`. For a body or MCP restart, the notice before it is a `pause`
(players see the brief maintenance line), the restart itself says nothing, and the `back` notice
says the maintenance has finished.

## Per-player host containers

`colo-cd.sh` restarts compose services only. The per-player hosts (`geldar-colo-players-host-<player-id>`,
started by `colo-admin.sh player-start`) are one-off containers and keep the image they were started with.
After the shared services, the deploy lists the running hosts (`colo-admin.sh player-list`) and refreshes each one
whose image differs from the release's body image, one at a time: a `bodies` maintenance notice, `player-stop`,
`player-start` (pinned to the node's manifest copy), a wait for the container to be Up and stay Up, and a check of its
image revision label. Hosts that are already current and hibernating players (no container) are not touched, and no
other container is. The plan (`plan: player host <id> stale|current`) and `--dry-run` show what would happen.
If a refresh fails, the loop stops, the host is started again from its previous image when that is possible, and
the run exits 1 with "needs manual": the shared services stay on the new release, and the next run retries the stale hosts.
`COLO_CD_PLAYER_WAIT` (seconds to wait for Up, default 60) and `COLO_CD_PLAYER_SETTLE` (seconds the host must stay Up, default 5) tune the wait.

## Rollback

Two ways, and the first is the usual one:

- On the node, run `deploy/colo-rollback.sh`. It takes no arguments. It re-applies the release
  recorded as previous, with `--pull never`. It refuses when no previous release is recorded. See
  `deploy/README.md`, section "Rollback".
- Dispatch an earlier commit on `main` that has a successful `colo-images` run:
  `gh workflow run colo-deploy.yml -f sha=<older sha>`. The entrypoint and `colo-cd.sh` decide what
  an older release does. Check the plan with `plan_only` first.

After either, read the job summary and the node status (`deploy/colo-status.sh`).

## Uninstalling the runner

These are owner actions on the node and in the repository settings. Do them in this order:

1. Stop the runner service and uninstall it, as the runner's own documentation describes
   (`svc.sh stop` and `svc.sh uninstall`, run from the runner directory).
2. Remove the runner registration: `config.sh remove` with a removal token, or delete the runner in
   the repository's Actions settings.
3. Remove the entrypoint, its `sudoers` rule and the inbox directory, so no unprivileged user can
   reach them.
4. Remove the runner's unprivileged user if nothing else uses it.

The `colo` environment and the workflow can stay. Without a runner, the job queues and never starts,
and no deploy runs. The `colo` environment has no reviewers, by the owner's rule: PRs are the
approval gate.

## Security model

The repository is public. Any branch can edit `colo-deploy.yml`, and a branch can target the runner
label. Such a job still reaches no privilege:

- The only privileged step is `sudo -n .../run plan|deploy <sha>`. The root-owned entrypoint refuses
  any SHA that main does not contain, and it fetches main itself. A branch cannot make it deploy its
  own code.
- The `colo` environment is limited to `main`, so GitHub does not start a job from another branch
  with that environment.
- The workflow runs no repository code: it checks nothing out.

What remains: unprivileged code can run as the runner's unprivileged user on the node. A branch
could read the runner's own files, and it could try to read the inbox.

Recommendations, for the owner:

- Give outside contributors the Triage role, not Write, so they cannot run workflows.
- Put the runner in an organization runner group that allows only this repository's `main` branch.
- Add a CODEOWNERS entry for `.github/workflows/`, so a workflow change needs a review.
