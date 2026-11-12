# Chunky (pregeneration)

Chunky is a Paper plugin that pregenerates world chunks ahead of players, so that the first visit to an area does not stall the server. The colo deploy mounts it into Paper read-only. It is not built from this repo.

## Pin

| Field | Value |
| --- | --- |
| Source | Modrinth project `fALzjamp` (Chunky), version `MdY6JATr` |
| Version | 1.5.3 |
| Published | 2026-05-04 (`released_at` in `chunky.lock.json`) |
| Asset | `Chunky-Bukkit-1.5.3.jar` |
| Licence | GPL-3.0-only |
| Minecraft | 26.1.2 is listed, which matches the Paper pin |

Chunky publishes no GitHub releases, so Modrinth is the source. The exact URL, sha256, sha512 and size are in `chunky.lock.json`.

## How the jar gets to the server

`deploy/colo-up.sh` calls `fetch_chunky` (in `deploy/common.sh`). It downloads the lock's `url` over https, checks the sha256 against the lock, and only then stores the jar at `$GELDAR_STATE_DIR/chunky/chunky.jar`. A mismatch stops the deploy before any pull or `up`. `compose/colo.yml` mounts that file read-only at `/plugins/chunky.jar`. If the lock file is absent the step is skipped.

## Tests

- `test/lock.test.ts` checks the lock's shape, the https CDN url, the 64-hex sha256, the 14-day age floor, the `release-dates.json` entry and the Paper support.
- `deploy/test/colo-chunky.test.ts` checks the store, dry-run, mismatch and url rules against a local fixture jar.

## How to bump

1. Pick a Modrinth version that lists the Paper Minecraft version and is at least 14 days old.
2. Download the jar into a new empty directory and run `sha256sum` and `sha512sum` on it. Take the size in bytes from the file.
3. Edit `chunky.lock.json`: `version`, `released_at`, `asset`, `url`, `sha256`, `sha512`, `size_bytes`, `release_page`, `minecraft_versions`.
4. Add `"modrinth:fALzjamp@<version>": "<released_at>"` to `tools/repo-checks/src/release-dates.json`.
5. Run `pnpm vitest run plugins/chunky deploy/test/colo-chunky.test.ts`, then `./geldar.ps1 check`.

Operator commands and tuning are in `docs/runbooks/chunky.md`.
