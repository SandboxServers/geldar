# FX-WATCHTOWER worknote: the Watchtower opt-out label on every colo service

Branch `fix/colo-watchtower-optout`, from `origin/main` (f600c52). The shared Colo node runs a Watchtower container that auto-updates containers it finds. The colo services are pinned by digest and change only through `deploy/colo-up.sh`, so an automatic pull would bypass the release record. This packet keeps Watchtower away from them with its opt-out label. It touches `compose/colo.yml`, `tools/repo-checks/src/loopback-ports.ts`, `tools/repo-checks/src/loopback-ports.test.ts`, `tools/repo-checks/src/colo-services.test.ts`, `deploy/README.md` and this note.

## What changed

- **The label, on every service.** `compose/colo.yml` has an anchor `x-labels: &colo-labels` with `com.centurylinklabs.watchtower.enable: "false"` and `com.geldar.stack: colo`. All seven services (postgres, nats, paper, velocity, eventsink, golem-body, animus) merge it with `labels: *colo-labels`. `compose/nats-auth.yml` adds no service, so it needs no label. Its services inherit the base labels.
- **The stack filter is unchanged.** `deploy/colo-status.sh` and `deploy/common.sh` scope docker calls by `com.docker.compose.project=geldar-colo`. The packet said to keep that filter and not invent one, so `com.geldar.stack` is a label only and no script reads it.
- **The rule.** `coloServiceProblems` in `loopback-ports.ts` calls `watchtowerProblem`. For a base file (colo.yml and colo*.yml) every service must set the key to `"false"`. The rule accepts the map form, the list form (`KEY=VALUE`) and a YAML `false` (compose writes it as `"false"`). It fails when the key is missing, when it is anything but false, when the `labels:` value is neither a mapping nor a list of strings, and when the key is misspelled (the missing-label message names the look-alike key). For the NATS overlay the rule applies only where the overlay sets the label. An overlay that sets it to `"true"` fails. An overlay that omits it passes, because the base supplies it.
- **Tests.** `loopback-ports.test.ts` has a new describe block with positive cases (map form, list form, YAML false, a label read through an anchor, phase0 unaffected) and negative cases (missing, `"true"` in both forms, misspelled key, wrong shape, overlay set to true). The shared fixtures (`hardened`, `coloService`, the merge-key case) carry the label. `colo-services.test.ts` asserts the exact label pair on every service of the committed file.
- **README.** `deploy/README.md` has a paragraph after the prerequisites explaining that the node runs Watchtower and the opt-out label keeps it away.

## Verification

- `docker compose -f compose/colo.yml config --quiet` exits 0. `docker compose -f compose/colo.yml -f compose/nats-auth.yml config --quiet` exits 0. The merged JSON (`config --format json`) shows `watchtower=false` and `stack=colo` on all seven services.
- `vitest run` on `loopback-ports.test.ts` and `colo-services.test.ts`: 94 of 94 pass.
- Revert, label removed from one service (velocity). The working file was backed up to the scratchpad, one line was removed, and `git diff --no-index --numstat` showed `0 1`, one deleted line. The two tests failed: `colo-services` (every service has the label) and `loopback-ports` (passes the committed compose/colo.yml). The file was restored from the backup and its hash matched.
- Revert, rule disabled. `loopback-ports.ts` was backed up, the call `problems.push(watchtower)` was disabled, and `loopback-ports.test.ts` ran. Five of the new negative cases failed (no label, label true, misspelled key, wrong shape, overlay true). The file was restored and its hash matched.
- Typecheck, `check:repo` and the merge-tree dry run are reported in the packet report.
