---
title: "Colo deploy from GitHub Actions"
type: how-to
audience: operators
status: draft
last_verified: 2026-11-16 against 03c1f5de
companions: [README.md, node-only-config.md, maintenance-notice.md, merge-queue.md, ../../deploy/README.md]
sources: [../decisions/0084-colo-deploy-by-pull-with-a-project-scoped-script.md, .github/workflows/colo-deploy.yml, deploy/colo-cd.sh, deploy/colo-cd-plan.sh]
---

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
   timeout is 30 minutes (`timeout-minutes: 30` in the workflow).
4. It resolves the commit (the run's head SHA) and the `colo-images` run that built it. The runner
   has no GitHub CLI (`gh`). The steps call the GitHub REST API with `curl` and read the replies with
   `jq`, using the job's `GITHUB_TOKEN`. On a manual dispatch without a SHA, the head of `main` comes
   from `GET /repos/{repo}/commits/main`. On a manual dispatch the SHA must be on `main`: the compare
   status of `main...<sha>` must be `identical` or `behind`. The successful `colo-images` run for the
   SHA comes from the workflow runs list, and the job fails when there is none. On a `workflow_run`
   event the job takes the SHA and run id from the event itself; this runbook's step 6 says the entrypoint
   still checks the SHA, but the entrypoint is root-owned and outside the repo ([node-only-config](node-only-config.md)
   item 14), and `deploy/colo-cd.sh` has no ancestor check, so that it refuses a SHA main does not contain is not
   checked in the repo.
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
`main` (the compare status must be `identical` or `behind`). It also refuses a commit with no
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

- a plugin jar or plugin config change (`plugin/`), and the Paper restart that loads it;
- a compose config change (it may define Paper, Velocity, Caddy or NATS);
- a Caddy config change (`deploy/caddy`) or a NATS config change.

The job summary lists the lines that the plan or the deploy printed with the words `needs manual`.
If the list says `None reported`, nothing was flagged. Read the list and the plan output before you
close a deploy. `deploy/colo-cd-plan.sh` prints a `folder <name> <sha256>` line for each of `plugin`,
`compose`, `caddy` and `nats` that has a file in the export, and `deploy/colo-cd.sh` prints
`needs manual: <what>` for a folder only when that hash differs from its record
`$STATE_DIR/applied.<folder>.sha256`. A folder with no record counts as differing, so until it is
recorded the item is listed on every deploy. A failed player host refresh also prints `needs manual`.

Once you have applied a folder's change on the node (copied the folder into the node's src extract,
`$GELDAR_COLO_ROOT`, and done what it asks), record the node's copies so that the list goes quiet:

```sh
sh deploy/colo-cd.sh --record-applied   # run from the src extract (the directory that holds deploy/); it writes applied.<folder>.sha256 only
```

The first time, run it once after the four folders in the node's src extract match main (copy them
across by hand first). Until then the three items print on each deploy, as they did before.

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
After the shared services, the deploy lists the running hosts and the hosts that exited non-zero (`colo-admin.sh player-list`,
which prints each host's actual state: `running`, `exited`, `created` or `dead`), and refreshes each one that is not current:
one whose image differs from the release's body image, or one that is not running (exited or stopped by hand, even on the
current image). It does this one at a time: a `bodies` maintenance notice, `player-stop`,
`player-start` (pinned to the node's manifest copy), a wait for the container to be Up and stay Up, and a check of its
image revision label. Hosts that are already current and hibernating players (no container) are not touched, and no
other container is. The plan (`plan: player host <id> stale|current`) and `--dry-run` show what would happen.
If a refresh fails, the loop stops, the host is started again from its previous image when that is possible, and
the run exits 1 with "needs manual": the shared services stay on the new release, and the next run retries the stale hosts.
`COLO_CD_PLAYER_WAIT` (seconds to wait for Up, default 60) and `COLO_CD_PLAYER_SETTLE` (seconds the host must stay Up, default 5) tune the wait.

The hosts use `unless-stopped` (decision 0342, which supersedes the `on-failure:5` part of decision 0169): a crash and a clean
exit by a node reboot both restart the host, with Docker's back-off and no restart cap. After an unattended reboot the
hosts come back on their own; check them with the list in "After an unattended reboot" below. A host that is still not
running after a reboot was stopped by hand with `player-stop` (which removes the container, so nothing restarts it), or its
`docker update` failed in `player-start`; start it with `colo-admin.sh player-start <id>`. A host that is up but has no
player in game after the reboot (step 2 of the check below) is idle. `player-start` leaves a running container as it is, so run `colo-admin.sh player-stop <id>` then `colo-admin.sh player-start <id>` for it, or wait for its next presence record (decision 0342).

## After an unattended reboot

The player hosts restart by themselves after a node reboot (decision 0342). After a reboot, check the node with these
read-only commands, from the repo root on the node. None of them changes anything, and none prints a secret.

1. The roster: the expected count is the number of `player_id` entries in the shard file. The online count from Paper must match it once every Body has joined.
   `grep -Eo 'player_id:[[:space:]]*ag-[a-z0-9-]+' shards/colo-mind.yaml | wc -l`
   `docker exec geldar-colo-paper-1 rcon-cli list`
2. The player hosts: the running ones are Up. A hibernating or never-started player has no container, so the count of running hosts is at most the roster of desired-up players from step 1; a player with no container shows `not running` in player-list.
   `docker ps --filter "label=com.docker.compose.project=geldar-colo" --filter "name=players-host" --format '{{.Names}}\t{{.Status}}'`
   `deploy/colo-admin.sh player-list` (`running` for each player; `exited` means stopped by hand or a failed update, or a crash that left it so)
   `docker inspect -f '{{.Name}} {{.HostConfig.RestartPolicy.Name}} {{.RestartCount}}' $(docker ps -aq --filter name=geldar-colo-players-host-ag-)`
   (read-only; each host prints its name, `unless-stopped` and its restart count; a policy other than `unless-stopped` was not set by `player-start`, so for that player run `player-start` if it is down, or `player-stop` then `player-start` if it is up (`player-start` alone leaves a running host as it is); a restart count that keeps growing is a crash loop, see [failure modes](../operations/failure-modes.md). With no host container the command prints an error, which means none exists.)
3. The shared services: `nats` and `paper` show `(healthy)` in the Status column.
   `docker ps --filter "label=com.docker.compose.project=geldar-colo" --format '{{.Names}}\t{{.Status}}'`
4. The telemetry stack: the `geldar-gateway` container and the other telemetry services are Up. It is a separate compose project, so use the telemetry check in [deploy/telemetry/README.md](../../deploy/telemetry/README.md), not step 3's `docker ps` (which filters on `geldar-colo`).
5. The NF project: every `geldar-nf` container is Up.
   `docker ps --filter "label=com.docker.compose.project=geldar-nf" --format '{{.Names}}\t{{.Status}}'`

Not verified from the repo: the exact container names of `nats`, `paper` and the telemetry services (`geldar-colo-paper-1`
is the name [deploy/README.md](../../deploy/README.md) uses; the others follow the same compose naming and were not checked on a node), and the
`rcon-cli list` output format, which the roster count reads from the online-players line.

## Telemetry env on the node

The operator-controlled deploy env file (the one `colo-cd.sh` reads) exports `GELDAR_TELEMETRY_URL` set to the in-network
gateway address, `http://geldar-gateway:4318`: the container name, not an IP. It is not a secret, and no token is in any env
or repo file. `compose/colo.yml` passes the name through with no value for `golem-body`, `eventsink` and `geldar-mcp` (and
`animus`, which ignores it); a service whose host environment lacks it runs with telemetry off.

A compose-only or env-only change restarts nothing. To apply it, recreate those services by hand or let the next image
deploy do it. If an upstream change to `compose/colo.yml` drops the pass-through lines, telemetry turns off for `eventsink`
and `geldar-mcp` without any error, so keep them.

## Body metrics on the player hosts

A player host (`geldar-colo-players-host-<player-id>`) pushes Body metrics only when `GELDAR_TELEMETRY_URL` is set in the
environment of the compose command that starts it. Unset or blank, the host starts no timer, sends nothing, and reports nothing.

- Start (`deploy/colo-admin.sh player-start <id>`): the variable must be exported in the shell that runs the script. The script
  sources no env file (`common.sh` only reads its own settings), so it takes the value from its caller. `compose/colo.yml` lists
  it for `players-host` with no value, so compose passes it through from that environment.
- Refresh (the CD's per-player loop in `colo-cd.sh`): `colo-cd.sh` sources the deploy env file (`COLO_CD_ENV_FILE`, default
  `/home/claude/colo-env.sh`) before it runs `colo-admin.sh`, so the file must export the variable. `state/node.env` is not the
  place: it holds only the trusted proxy lists and is never sourced.
- Not checked on a node: the `colo.yml` comment says `compose run` may not apply the pass-through key. Run the check below after
  the first start to see whether it did.
- The value is the gateway's in-network OTLP/HTTP base URL, written in the node's deploy env file. Never put it in the repo,
  a message, a log or a PR. Do not copy it anywhere else.
- A refresh that runs without the variable exported restarts each stale host with telemetry off. `player-start` leaves a running
  host alone, so to turn telemetry on for a running host, run `player-stop <id>` and then `player-start <id>`.
- Check after a start (read-only; the value is never printed):
  `docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' geldar-colo-players-host-<id> | grep -c '^GELDAR_TELEMETRY_URL=.'`
  prints `1` when the host has the variable set and non-empty, `0` when it does not. Then, in SigNoz, Body metric series with a
  `service.instance.id` for that host appear after its first push. No series means the host runs with telemetry off.

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
