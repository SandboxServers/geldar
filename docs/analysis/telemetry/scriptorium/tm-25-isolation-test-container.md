# TM-25: isolation test (HC-26 extension), container level: the model uid cannot read the supervisor's environment or the token (scriptorium repo)

Repo: geldar-scriptorium. Depends on: TM-24. Unblocks: the N13 install (TM-34). Mind redeploy: none (test only). `colo-images` path: n/a. Needs Docker: the ops agent runs it (R11), never the coder.

## What it proves

TM-24 proves what the supervisor passes. This proves what the operating system lets the model's uid read, in the real kit container with the real uid split (supervisor 1001, model child 1000, `image/compose/player.yml`). The threat: the model child (or a tool it somehow controls) reads the supervisor's `/proc/<pid>/environ`, its command line, its state directory, or a file holding the token.

## Files (exactly these)

- `tests/isolation/container-isolation.test.ts` (new): vitest file, skipped unless the Docker gate variable is set (use the same gate the existing docker-using tests use: read `tests/e2e/e2e.test.ts` and `launcher/test/harness.ts` first; if there is none, gate on `GELDAR_DOCKER_IT=1`).
- `tests/isolation/README.md` is NOT created (the test file header comment holds the run command).

## Method

1. Build and start the stub kit (`image/stub.Dockerfile`, stub CLI in place of the real one) as a throwaway container named with a random suffix, with the kit's real entrypoint, the same user, capability set and read-only settings as `image/compose/player.yml`, and these planted in the container's environment (the supervisor's environment): `GELDAR_INGEST_TOKEN=canary-ingest-token-7f3a`, `OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer canary-ingest-token-7f3a`, `GELDAR_TELEMETRY_URL=http://127.0.0.1:4318`. (If the compose project is easier than raw `docker run`, use `docker compose -f image/compose/session.test.yml` as it already exists for tests.)
2. Wait for the supervisor heartbeat, then for one stub run to start (a stub scenario that waits is enough; reuse `play-day-1.jsonl`).
3. As the model uid (`docker exec --user 1000:1000`, no shell tricks beyond `sh -c`), run the probes below. Each probe's expected result is part of the test.

## Probes and expected results

| # | Probe (as uid 1000) | Expected |
|---|---|---|
| P1 | `cat /proc/<supervisor pid>/environ` | exit non-zero, `Permission denied`; no canary in output |
| P2 | `stat -c '%u %a' /proc/<supervisor pid>/environ` | owner is 1001 or 0, mode `400`; not world or group readable |
| P3 | `cat /proc/1/environ` (the init process, root, which started the supervisor and holds the same planted environment) | `Permission denied`; no canary in output. A readable init environment fails the test |
| P4 | `tr '\0' '\n' < /proc/<child pid>/environ` for the stub CLI child | readable (own uid); contains no `canary`, no key matching `OTEL\|TELEMETRY\|INGEST` (`TRACEPARENT` and `TRACESTATE` are never allowed: the child gets no telemetry context) |
| P5 | `cat /proc/*/cmdline` for every process, then search | no `canary` (an argv is world-readable; a secret must never be passed there) |
| P6 | `ls /state/supervisor`, `cat /state/supervisor/supervisor.log` | denied (the directory is closed to uid 1000) |
| P7 | `find / -xdev -readable -type f` limited to `/etc /run /var /tmp /player /cli-home` then `grep -l canary` | no file contains the canary (the token is in no readable file) |
| P8 | `env` as uid 1000 via `docker exec` | no canary (weak by itself, kept to catch an image-level `ENV`) |
| P9 | the session file the child wrote, read as the supervisor | no canary (the stub does not echo its environment; a scenario line that prints it is NOT added) |

Also check from outside: `docker inspect` of the stub container shows the canary in `Config.Env` (it is the supervisor's environment, visible to the Docker host's root, which is the accepted trust, collector-design 9); the test prints this as an informational line, not a failure.

## Steps

1. Write the test with the probe table as data (array of `{ id, command, assert }`), one `it` per probe so a failure names the probe.
2. The test always removes its container and image tag in an `afterAll`, even on failure.
3. Revert checks (the ops agent runs these once, by hand, and records them): (i) start the container with `--user 0` for the probes (as root) -> P1 must FAIL (proves the probe can detect a readable environment); (ii) add the canary to an argv of the supervisor (`GELDAR_X=...` as an argument in a copy of the entrypoint) -> P5 must fail; (iii) write the canary to `/tmp/x` mode 0644 -> P7 must fail.

## Expected result

All probes pass on the kit image of the day. A failure is a stop-ship: no endpoint variable may be set on a Mind until it passes.

## Checks and commit

Coder: `pnpm lint`, `pnpm typecheck`, `pnpm check:repo`, `git diff --check`; the test file must be skipped, not failing, without Docker. Ops agent: runs it with the gate variable and reports each probe's result. Commit: `T-14 TM-25: HC-26 extension, container test that the model uid cannot read the supervisor environment (tests)` plus the two trailers.

## Do NOT

- Do not use the real CLI, a real token or the real image's credentials; stub image only.
- Do not mount a Docker socket into any container.
- Do not leave containers or images behind.
- Do not weaken a probe to make it pass: report the failure instead.
