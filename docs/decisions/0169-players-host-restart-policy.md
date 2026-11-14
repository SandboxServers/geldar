# 0169: A player host restarts itself on failure, up to five times, and keeps its logs

- Status: Accepted (owner instruction, 2026-11-13, after the incident of the same day)
- Date: 2026-11-13
- Amends: the run line of `deploy/colo-admin.sh player-start` (it was `run -d --rm`) and the `restart` key of the `players-host` service in `compose/colo.yml`; extends decision 0082 (log rotation) to the player hosts with the same cap.

## Context

Each ranger has one player host, a one-off container named `geldar-colo-players-host-<player>`, started by `deploy/colo-admin.sh player-start`. The container was started with `--rm`, so when it exited it was removed with its logs, and nothing restarted it. On 2026-11-13 two ranger hosts crashed on an uncaught exception (fixed in #327). Each stayed down until someone started it by hand, about 25 minutes later, and the crash logs were already gone.

## Decision

1. A player host is no longer removed when it exits. Its logs stay with docker's json-file driver, capped at 10 MiB per file and 3 files, the cap decision 0082 gives every other service.
2. A host restarts only on failure: the policy is `on-failure:5`. A non-zero exit restarts it, at most five times. A clean exit (exit 0: `player-stop`, a CD refresh, the presence watch ending) does not restart it.
3. `compose run` has no restart flag, so `player-start` sets the policy after the container starts with `docker update --restart on-failure:5`. The `players-host` service in `compose/colo.yml` carries the same `on-failure:5` as the template; the run path does not read that key.
4. Every path that recreates a host removes the old container first. `player-start` removes a stopped leftover with `docker rm -f` before it runs a new one. `player-stop` stops and removes the container, as before.
5. `player-list` reports a container that is present but not running as `exited`, so the CD can see it.
6. What the CD does with an exited host: a host that exited non-zero (a crash that used up its five restarts) is refreshed, so a deploy brings it back. The CD stops it, starts it on the new image and checks that it is up. A host that exited 0 is skipped, as before, because it was stopped on purpose.

## Consequences

- A ranger whose host keeps crashing stays down after the fifth failed restart. The container stays in `docker ps -a` as exited, with its logs, until the next deploy refreshes it or someone runs `player-start`. A crash loop is visible; it is not hidden by a silent restart forever.
- The restart count is docker's own. It resets when the container is recreated.
- The policy is applied after the container starts. A crash in the first moments, before `docker update` runs, is not restarted. That window is small and is accepted for now.
- The Docker version on the node is not checked by this change. `docker update --restart` and `docker rm -f` need a Docker release of several years; the node's version has not been confirmed.
- The log cap is the house 10 MiB, not the 20 MiB first asked for. Decision 0082 sets one cap for every service, and `tools/repo-checks` pins it for the player host too. Changing it would be a separate decision.
- Nothing in this record changes the Body or the Mind.
