# 0169: A player host restarts itself on failure, up to five times, and keeps its logs

- Status: Accepted (owner instruction, 2026-11-13, after the incident of the same day). Known limit, may need an owner call: see Consequences.
- Date: 2026-11-13
- Amends: the run line of `deploy/colo-admin.sh player-start` (it was `run -d --rm`) and the `restart` key of the `players-host` service in `compose/colo.yml`; extends decision 0082 (log rotation) to the player hosts with the same cap.

## Context

Each ranger has one player host, a one-off container named `geldar-colo-players-host-<player>`, started by `deploy/colo-admin.sh player-start`. The container was started with `--rm`, so when it exited it was removed with its logs, and nothing restarted it. On 2026-11-13 two ranger hosts crashed on an uncaught exception (fixed in #327). Each stayed down until someone started it by hand, about 25 minutes later, and the crash logs were already gone.

## Decision

1. A player host is no longer removed when it exits. Its logs stay with docker's json-file driver, capped at 10 MiB per file and 3 files, the cap decision 0082 gives every other service.
2. A host restarts only on failure: the policy is `on-failure:5`. A non-zero exit restarts it, at most five times. A clean exit (exit 0: `player-stop`, a CD refresh, the presence watch ending) does not restart it.
3. `compose run` may not apply the restart key of the template to a one-off container, so `player-start` also sets the policy after the container starts with `docker update --restart on-failure:5`. The update sets it either way. The `players-host` service in `compose/colo.yml` carries the same `on-failure:5`. Whether `compose run` applies it on the node has not been checked.
4. Every path that recreates a host removes the old container first. `player-start` removes a stopped leftover with `docker rm -f` before it runs a new one. `player-stop` stops and removes the container, as before.
5. `player-list` reports the actual state of a container that is present but not running (`exited`, `created` or `dead`), so the CD and an operator can see it. A restarting host is listed as `running`, because `docker ps` lists it so; the CD reads its true state with `docker inspect`.
6. What the CD does with a player host, after the shared services. It refreshes a host that is not current: one whose image differs from the release body image, and one that is not running, even on the current image. So a host that exited non-zero (a crash that used up its five restarts) is brought back by a deploy, whatever image it runs. A running host on the release image is left alone. A restarting host is not current, so it is refreshed (stopped, then started), which ends its restart loop. A host that exited 0 is skipped, as before, because it was stopped on purpose. The CD stops the host, starts it on the new image and checks that it is running with a restart count of 0 and the release revision label. A host that restarts during that settle fails the refresh; the old image is restored and the run exits 1 with "needs manual".
7. A failed `docker update` after `compose run` is a warning, not a failure. The host is left running, `player-start` prints that it cannot set the restart policy, and it exits 0. So the CD does not restore a healthy host. The host has no restart policy until the next `player-start`.

## Consequences

- A host that keeps failing stays down after the fifth failed restart. It stays in `docker ps -a` as exited (or created or dead), with its logs, until the next deploy refreshes it or someone runs `player-start`. Its state is visible in `player-list`; it is not restarted silently forever.
- Known limit, owner call. `on-failure:5` counts restarts for the life of the container. Docker does not reset the count after a long healthy run. A host that crashes once a day, and is restarted each time, uses its five restarts in about five days and then stays down until a deploy or a `player-start` recreates the container. Recreating a container resets the count. The policy is not changed by this record. The owner must decide whether five restarts per container lifetime is the budget wanted, or whether a reset (a watcher, or a step in the CD) is added.
- The restart count is docker's own. It resets when the container is recreated (a deploy or `player-start`).
- The policy is applied after the container starts. A crash in the first moments, before `docker update` runs, is not restarted. That window is small and is accepted for now. Whether `compose run` applies the template's key on the node is not verified; the update makes the result the same either way.
- After a node reboot, the hosts do not start. Only `unless-stopped` or `always` would start a container after a reboot, and this record keeps `on-failure:5`. A host stopped by the reboot exits 0, so the CD skips it. The CD or an operator must start it again with `colo-admin.sh player-start <id>`. The owner may revisit the policy for this.
- The Docker version on the node is not checked by this change. `docker update --restart` and `docker rm -f` need a Docker release of several years; the node's version has not been confirmed.
- The log cap is the house 10 MiB, not the 20 MiB first asked for. Decision 0082 sets one cap for every service, and `tools/repo-checks` pins it for the player host too. Changing it would be a separate decision.
- Nothing in this record changes the Body or the Mind.
