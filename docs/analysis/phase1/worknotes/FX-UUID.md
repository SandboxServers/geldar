# FX-UUID: override uuid to 11.1.1

## What

`pnpm-workspace.yaml` `overrides:` pins `uuid` to `11.1.1`. `pnpm-lock.yaml` now resolves
every `uuid` to 11.1.1 (no `uuid@8` or `uuid@10` remains). `golem/src/deps-uuid.test.ts`
walks the mineflayer dependency chain and asserts the uuid version each consumer resolves.
`tools/repo-checks/src/release-dates.json` gains the `npm:uuid@11.1.1` publish date, which
the release-floor check requires for every lockfile entry.

## Why

Dependabot alert 1 (medium): `uuid` < 11.1.1 misses a buffer bounds check in v3, v5 and v6
when a caller passes a buffer. `uuid` is transitive only:

- `@azure/msal-node@2.16.3` (via `prismarine-auth` -> `minecraft-protocol` -> `mineflayer` -> golem) pulled uuid 8.3.2.
- `yggdrasil@1.8.0` (via `minecraft-protocol`) pulled uuid 10.0.0.

Both were resolved before this change. No direct use of uuid exists in first-party code.

## Evidence

- `pnpm why uuid -r` after the override: one version, `uuid@11.1.1`, reached from both
  `@azure/msal-node@2.16.3` and `yggdrasil@1.8.0`.
- `pnpm-lock.yaml` grep for `uuid@` after install: only `uuid@11.1.1` entries.
- 11.1.1 publish time from the registry: `2026-04-29T15:17:24Z`. This is past the
  14-day `minimumReleaseAge` floor (decision 0005).
- `./geldar.ps1 check`: all checks passed (vitest 408 files passed, 4580 tests passed).
  Biome printed diagnostics for files outside this change; the lint step still passed.

## Revert-check

1. Removed the two-line `uuid: 11.1.1` override (and its comment) from `pnpm-workspace.yaml`.
2. `pnpm install` resolved `yggdrasil` to uuid 10.0.0 and `@azure/msal-node` to uuid 8.3.2.
3. `vitest run src/deps-uuid.test.ts` failed both tests:
   `expected '10.0.0' to be '11.1.1'` and `expected '8.3.2' to be '11.1.1'`.
4. Restored `pnpm-workspace.yaml` and `pnpm-lock.yaml` from backup, reinstalled, and reran:
   2 of 2 passed. `git diff --stat` was empty afterwards.

## Known flaky tests

The full `./geldar.ps1 check` passed with `golem/src/test-control.test.ts` and
`lantern-local/test/thinker.test.ts` included. Neither needed a rerun.
