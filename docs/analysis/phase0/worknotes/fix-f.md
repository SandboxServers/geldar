# Fix F worknote (supply chain, CI, images)

Branch fix/f-supply-chain, base wave6-main. Date of work: 2026-11-10.

## Item 1: npm age (done)

- pnpm 12.15.0 supports `minimumReleaseAge` (minutes). Set to `20160` (14 days) in `pnpm-workspace.yaml`.
- pnpm's own lockfile policy check rejects young entries, so the lockfile had to be rebuilt
  (`pnpm clean --lockfile`, then `pnpm install`) after adding overrides.
- Overrides added, newest release published on or before 2026-10-27 in the same major:

| Package | Was (published) | Now |
| --- | --- | --- |
| hono | 4.13.17 (2026-11-07) | 4.13.14 (2026-10-25) |
| express-rate-limit | 8.7.3 (2026-11-02) | 8.7.1 (2026-10-06) |
| jose | 6.2.15 (2026-11-01) | 6.2.13 (2026-10-20) |
| ip-address | 10.7.6 (2026-11-03) | 10.7.5 (2026-10-25) |
| @hono/node-server | 2.1.6 (2026-11-02) | 2.1.5 (2026-10-13) |
| vite (dev) | 8.3.6 (2026-11-05) | 8.3.5 (2026-10-21) |
| tinybench (dev) | 6.2.3 (2026-11-01) | 6.2.2 (2026-10-10) |
| rolldown (dev) | 1.2.16 (2026-10-29) | 1.2.15 (2026-10-21) |
| @types/estree | 1.0.10 (2026-10-29) | 1.0.9 (2026-05-06) |
| encodeurl | 2.0.1 (2026-10-28) | 2.0.0 (2024-03-29) |
| qs | 6.17.1 (2026-10-28) | 6.17.0 (2026-10-27 06:23 UTC) |

- Three extra young transitives (@types/estree, encodeurl, qs) were not in the brief; found by pnpm's policy check.
- The lockfile diff touches only these packages, their rolldown binding variants, and @oxc-project/types (0.156.0 to 0.155.0, rolldown's dependency).
- No package could not be downgraded; no peer range broke.
- Lookup command used: `npm view <pkg> time --json`, then pick the newest version at or before the cutoff.

## Item 2: pin-rule checks (done)

- `tools/repo-checks/src/pin-rules.ts` (wired into `cli.ts`, run by `check:repo`):
  - package.json dependency ranges (`dependencies`, `devDependencies`, `optionalDependencies`) are exact or `workspace:`; peer ranges are exempt.
  - Dockerfile `FROM` names a digest, `scratch`, or an earlier stage.
  - Compose service images have a digest, except services with `build:`.
  - Workflow `uses:` is a local path, a `docker://` digest, or a full 40-hex commit SHA.
  - `pnpm-lock.yaml` has no tarball, git, directory, or file sources.
- Age (14 days) is not checked offline. Manual step: `npm view <pkg> time --json` for each direct and overridden package before a lockfile change.
- `threshold/mcp-mock/compose.example.yml` was a tag-only ghcr image; pinned to `main`'s digest `sha256:615c9160...7d97` (resolved with `docker buildx imagetools inspect`, our own image).
## Item 3: Docker base and pnpm (done; local build not run)

- `eventsink/Dockerfile`: `node:22.23-alpine` (Node 22.23.4, pushed 2026-11-05, floating) is now `node:22.23.2-alpine@sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85`, the .nvmrc patch. Resolved with `docker buildx imagetools inspect node:22.23.2-alpine`; the amd64 image's Created date is 2026-09-17 (older than 14 days).
- `package.json` `packageManager` is `pnpm@12.15.0+sha512.<hex>`; the hash is the registry tarball integrity (`npm view pnpm@12.15.0 dist.integrity`, base64 to hex). pnpm 12.15.0 was published 2026-10-21.
- `threshold/mcp/Dockerfile` and `threshold/mcp-mock/Dockerfile`: `npm install -g pnpm@12.15.0` replaced by `corepack enable`, which uses the verified packageManager.
- `checkPackageManagerHash` in `pin-rules.ts` fails the check when the root packageManager has no sha512.
- Not run: a local `docker build` (Docker 29.1.3 is present). CI builds the images in item 5.