# 0342. Body hosts restart with unless-stopped

- Status: Decided
- Date: 2026-11-18
- Cites: 0169 (the per-player host: no `--rm`, json-file logs, the CD refresh). Supersedes the restart part of 0169 only: the policy `on-failure:5` in its item 2 and item 3 is replaced by `unless-stopped`. The other parts of 0169 stand.
- Why: after an unattended node reboot, 15 of 19 player hosts stayed down. Docker stops a container with SIGTERM at a reboot and it exits 0. `on-failure:5` restarts only a non-zero exit, so a clean exit by the reboot was never restarted. `unless-stopped` restarts it after the reboot, and a container the operator stopped by hand (`docker stop`, which `player-stop` runs) stays down, because Docker records the manual stop.
- What (1): the restart policy of every per-player host is `unless-stopped`. `deploy/colo-admin.sh player-start` sets it with `docker update --restart unless-stopped` after `compose run`, and `compose/colo.yml` (`players-host`) carries the same value. The CD (`deploy/colo-cd.sh`) does not set the policy and needed no change.
- What (2), the stop path: `player-stop` (`docker stop`) is how an operator stops a host, and it holds: the host is not restarted by a crash, a reboot or the daemon. `player-start` starts it again.
- What (3), the trade-off, accepted: `on-failure:5` capped the restarts of a crash loop at five per container lifetime (0169, the known limit). `unless-stopped` has no cap. A crash loop keeps restarting, with Docker's exponential back-off between restarts (the delay grows and is not reset by the policy). The restart count (`docker inspect`, `RestartCount`) is the signal of a crash loop, and an operator stops the host with `player-stop` when it must not run.
- What (4), the failure message: if `docker update` fails, `player-start` still exits 0 and prints that a crash or a reboot will not restart the host. The CD does not treat such a host as failed (0169, unchanged).
- Not in this record: a change to the CD refresh (a stopped host is still refreshed), the restart count reset, the refresh of hosts stopped by hand, or any Paper, Velocity or Body code. No world change. `docs/spec.md` is not touched.
- Rollback: revert the commit that adds this record. The old policy is `on-failure:5` (`docker update --restart on-failure:5` for each host, and `restart: on-failure:5` in `compose/colo.yml`).
