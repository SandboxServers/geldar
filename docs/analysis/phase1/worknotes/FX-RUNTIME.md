# FX-RUNTIME worknote: colo containers can load their config

Branch `fix/c1-colo-runtime-config`, from `origin/main` (5c1d65f). Decision: [0131](../../../../decisions/0131-colo-in-container-hosts-and-mind-shard-file.md). Commits: `57cef6a` (the fix and the Mind shard file), `3bda148` (format), `007413d` (the colo life id), and the commit that adds this note.

## The defect

The C1 boundary review found that the colo containers could not start. Two causes, both confirmed by reading the loaders:

1. The golem and animus config loaders accept only loopback hosts (decision 0050, Phase 0). Inside the colo compose network the peers are service names (`nats`, `postgres`, `paper`, `velocity`), so the loaders refused them.
2. `golem-body` and `animus` read `shards/<GELDAR_SHARD>.yaml`. Compose mounted `shards/colo.yaml`, which is the flat budget file that `geldar.ps1` reads and refuses to extend. It has none of the Mind's blocks.

Nothing ran the entry points before, and the image and compose tests read files as text, so neither defect was caught.

## What changed

- **In-network opt-in.** Loopback stays the default. A closed allowlist of `nats`, `postgres`, `paper` and `velocity` is accepted only when `GELDAR_IN_NETWORK_HOSTS` is exactly `1`. Compose sets it for `golem-body` and `animus` and for no other service. Any other host is refused, with or without the opt-in. Without the variable, behaviour is unchanged, so Phase 0 is unaffected.
  - golem: `hostAllowed` in `golem/src/config.ts`, used by the NATS and Minecraft host checks, and by `assertLoopbackNatsUrl` in `golem/src/body/restart.ts`.
  - animus: `loopbackHost` in `animus/src/config.ts`, used for the Postgres host and the Thinker host.
- **A real Mind shard file.** `shards/colo-mind.yaml` is a full shard file derived from `shards/phase0.yaml`, without `sovereign`. Compose mounts it at `/opt/geldar/shards/colo.yaml` for `golem-body` and `animus`. The container path keeps the name the loaders expect. `shards/colo.yaml` is unchanged.
- **The Thinker is a placeholder.** `mind.thinker` is `127.0.0.1:7410`, named `unreachable-placeholder`. This is a loopback socket inside the Mind's own container, which nothing outside reaches. Thoughts cannot run in the container until the Thinker gateway exists (decision 0078). The gateway packet replaces the three values.
- **The colo life id is `ag_colo_01`.** It was `ag_adam_03`, the phase0 id. A shared life id would let the desktop Phase 0 stack and the colo shard claim one name lease. `lives.strong` follows the change. The `fast` and `smoke` entries stay as phase0 has them, because no colo run uses them.

## Tests and evidence

- `golem/src/colo-env.test.ts` and `animus/src/colo-env.test.ts` cover the opt-in: accepted with `GELDAR_IN_NETWORK_HOSTS=1`, refused without it, and the colo shard loads with the expected life id.
- Revert check (run on this branch): I removed the opt-in gate in `hostAllowed` (golem) and in `loopbackHost` (animus) in turn, leaving the allowlist. `refuses the compose service names without the opt-in` failed in both packages. I then restored both lines and confirmed `git status` was clean.
- Passing, after the final changes:
  - golem `config`, `colo-env`, `body/restart`, and animus `config`, `colo-env`: 63 tests.
  - `tools/repo-checks` and `tools/adam-cli`: 280 passed, 1 skipped, across 28 files.
  - `docker compose -f compose/colo.yml config --quiet`: exit 0.
  - `golem` and `animus` typecheck: clean.
  - `biome ci` on the touched files: clean.
  - Merge-tree against `origin/main`: exit 0.
- `pnpm check:repo` fails only on the missing 0131 index row (below). Its other warnings are about file length and were already present.
- One run of the combined `tools/repo-checks` and `tools/adam-cli` suite, right after the life id change, had 7 failures in one file. I did not capture the failing file name. Three later runs of the same suites all passed. I could not explain the single run, so treat it as an open item.

## Index row for ops

The ops merge step adds this row to `docs/decisions/README.md`. This branch does not edit that file:

```
| [0131](0131-colo-in-container-hosts-and-mind-shard-file.md) | Colo containers reach their compose peers by name through a closed, opt-in allowlist; the Mind's shard file is `shards/colo-mind.yaml`, separate from the budget file | Accepted (orchestrator, 2026-11-10) |
```

## Deviations from the packet

- `golem/src/body/restart.ts` and `tools/repo-checks/src/colo-services.test.ts` were edited outside the original file list. `restart.ts` had its own loopback check for the NATS URL, which the opt-in had to reach. `colo-services.test.ts` asserted the old mount source. Both changes are needed for the fix to be consistent.
- The host rule is duplicated: `hostAllowed` in golem and `loopbackHost` in animus. The two packages share no helper module, so each has its own minimal copy. Decision 0131 records this.
- The commit trailer names Claude Haiku 5.5, which is the model I am running as, not the Sonnet 5.5 line the brief gave.

## Unverified

- No container was started (packet C1-10). Whether the containers start, and whether the entry points run in the image, is not verified here. Compose config validity is verified; runtime is not.
- The Mind cannot run a thought in the container until the Thinker gateway exists.

## Follow-ups

- `golem-body` does not mount the RCON secret. This is harmless, because the Body does not use RCON, and `GELDAR_RCON_PORT` is set only for completeness (decision 0131).
- Extract a shared host-validation helper, so golem and animus stop carrying duplicate allowlists. This needs a package boundary decision, so it is not part of this packet.
- The Thinker gateway packet replaces the placeholder `thinker` values in `shards/colo-mind.yaml`.
