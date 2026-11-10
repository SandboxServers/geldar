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
## Item 4: MCP image slimming (stopped; import edges documented, no refactor)

The refactor was too large for this session's context. Production (non-test) import edges from `threshold/mcp/src`, found with a grep for `@geldar/(animus|mcp-mock|repo-checks)`:

- `@geldar/mcp-mock` (values): `cli.ts` (RealClock), `world.ts` (several), `resources.ts` (buildSnapshot-style exports and a `listPrompts` re-export), `world-session.ts` (callTool, listTools), `http/front.ts` (createMockHttp), `tools/wait.ts`, `tools/sleep.ts`, `tools/read-book.ts`, `tools/unavailable.ts` (ToolError). Types only: `ports.ts` (Clock), `main.ts`, `events/mapper.ts`, `events/present.ts`, `events/player-log.ts`, `events/stream.ts`, `fakes/stores.fakes.ts`, `http/front.ts`.
- `@geldar/animus` (values): `cli.ts` and `body-gateway.ts` (`nats-body-link.ts`), `events/stream.ts` (`link/mind-event.ts`), `events/speech.ts` (`attention/classify.ts`), `main.ts` (`validate/index.ts`), `world.ts` and `tools/act.ts` (`ids.ts`, `loop/plan.ts`), `record/sovereign-call.ts` (`ids.ts`), `fakes/world.fakes.ts` (`validate/index.ts`). Types only: `events/mapper.ts`, `store/pg-agents.ts`, `tools/say.ts`, `world.ts`, `main.ts`.
- `@geldar/repo-checks`: `main.ts` imports `checkSovereignIdentity` from `repo-checks/src/identity-mode.ts` at runtime. That file is small and has no workspace imports.
- Test-only edges (not a runtime concern): every `*.test.ts`, `test/fixtures/real-body-feed.ts`, `test/live/live-requests.test.ts`, `fakes/*.fakes.ts` if they are not imported by runtime code.

Proposed fix for the next session: move the runtime-used pieces (the SimEvent and Clock types, ToolError, the output validator, `buildPlan`, `newId`, `classifySpeech` and the speech identity type, `normaliseEvent`/`mindEventSubjects`, the body link and its errors, and `checkSovereignIdentity`) into `contract/` or a small `shared` package that both `threshold/mcp` and `threshold/mcp-mock` depend on. Then make `threshold/mcp/Dockerfile` install `--filter "@geldar/mcp..."` against that package only, and tighten `Dockerfile.dockerignore` to match. `container.test.ts` must still pass.

Current state: the Dockerfile still installs the `@geldar/mcp...` closure, which includes animus, mcp-mock and repo-checks. Nothing is changed for this item.
## Item 5: CI (done, not run in CI yet)

- `images` job builds `eventsink/Dockerfile` and `threshold/mcp/Dockerfile` with `push: false`, in the gate.
- `integration` job: the pgvector image digest from compose/phase0.yml, POSTGRES_USER geldar (superuser, as in compose), GELDAR_IT=1, POSTGRES_HOST/PORT. Migrations are applied with psql, then the job writes compose/secrets/postgres.txt (CI only) and runs pg-stores, sleep-marks-grants, pg-migrate, scram-login, schema-check, tools/mcp-tokens cli.it, animus memory.it, glass/test/glass.it.test.ts and tools/adam-report/test/report.it.test.ts (pgvector is in the image; its Ollama round trip stays skipped without GELDAR_OLLAMA).
- The two cases the campaign review named as `glass.it` and `adam-report report.it` exist under their full paths: `glass/test/glass.it.test.ts` and `tools/adam-report/test/report.it.test.ts`. An earlier note wrongly said they did not exist (the search used the short names). Both need only Postgres and the migrate runner, so both are in the job now.
- Not included: NATS and Ollama cases (`eventsink/test/*.it.test.ts`, `golem/src/mind-link/server.it.test.ts`, `lantern-local/test/ollama.it.test.ts`) and the Paper cases. The first two need a live NATS.
- Not run here: no database was started (run rules). The integration job is unverified until CI runs it.
- `mcp-mock-image.yml`: `image` (no packages permission) builds and tests on PRs and main. `publish` needs `image`, runs only on main, and holds `packages: write`. `publish` repeats the original sequence on its own loaded image: build (load, not push), image test, login, `docker push` of that same image. So the pushed image is the one its test ran against. It does not rebuild and push with `push: true`; a loaded image cannot cross jobs without an artifact action, which is why the build runs again inside `publish` instead of being passed from `image`.
- `threshold/mcp-mock/src/workflow.test.ts`: the ordering checks are scoped to `publish`; the build-record check expects one build per job (two); the image job is asserted to hold no `packages: write`, no login and no push. Reverted check: changing publish's build from `load: true` to `push: true` fails "tests the loaded image before it logs in or pushes" and "pushes the image the test ran against"; restored.
- `tools/repo-checks/src/workflow-jobs.test.ts`: every ci.yml job is in the gate's needs; only `publish` holds packages: write, and only on main. Reverted checks: removing `images` from the gate needs fails the first test; `packages: write` to `read` in publish fails the second. Both restored.

## Item 6: Dependabot, ignores, PNG leak scan (done)

- `.github/dependabot.yml`: docker entries for `/threshold/mcp` and `/threshold/mcp-mock`, and a `docker-compose` entry for `/compose`. The existing `docker` entry for `/compose` stays. Not verified online. Dependabot's docker-compose ecosystem matches compose file names such as `docker-compose.yml` and `compose.yml`; `compose/phase0.yml` does not match, so Dependabot does not see its image digest. Renaming the file is an owner call and not done here.
- `.gitignore`: `*.pem`, `*.key`, `compose/cloudflared/*.json`, `**/credentials.json`, `.agents/`, `.codex/`. `git ls-files -ci --exclude-standard` lists only the existing `.claude/reports/*` files, which predate these rules.
- `tools/players-cli/src/leak-scan.ts`: a PNG outside `docs/` is now a finding (`PNG_OUTSIDE_DOCS`), in addition to skins/ anywhere. No tracked PNG exists in the repo today, so the repo-wide test still passes. Revert check: removing the PNG rule from `findLeaks` fails the new test "flags a PNG outside docs/"; restored.
