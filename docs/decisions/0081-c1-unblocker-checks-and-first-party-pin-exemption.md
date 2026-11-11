# 0081. C1 unblocker checks and the first-party pin exemption

- Status: Accepted (owner ruled 2026-11-10)
- Date: 2026-11-10
- Spec: decision 0005 (exact pins, two-week minimum age); Phase 1 packet C1-00 (the unblocker for wave C1). Registry number 0081 is reserved for this packet.

## Decision

1. **Release-age check.** `tools/repo-checks` fails when a third-party version or digest the repo pins was published less than 14 days before the check. Publish times come from `tools/repo-checks/src/release-dates.json`, which maps each pin key (for example `docker:<image>@sha256:...`) to an ISO publish time. A pin with no date, or an unreadable date, fails.
2. **First-party allowlist.** `tools/repo-checks/src/first-party-images.json` lists the repository prefixes of images this repo builds from its own reviewed source. An image whose repository starts with a listed prefix is exempt from the 14-day rule and needs only a digest pin. A first-party image that is not pinned by digest fails. An image that matches no prefix is third-party and follows the age rule.
3. **Integration floor.** `tools/repo-checks/src/integration-floor.json` holds `{ "floor": 44 }` at the time of this record. The check counts `*.it.test.ts` and `*.live.test.ts` files that contain an `it(` call. It fails below the floor and fails when the count or the floor cannot be read. The floor rises as integration files are added; lowering it needs a record.
4. **Decision-index drift, both directions.** Every `docs/decisions/NNNN-*.md` file must have a row in `docs/decisions/README.md`, and every row must point at a file that exists.
5. **mcp-tokens in typecheck.** `tools/mcp-tokens` is covered by `pnpm typecheck`. It already was on main, so this branch changes nothing for it.

## The first-party exemption

The 14-day rule guards the third-party supply chain: a release that is days old may carry a compromise the wider world has not yet caught. An image built from this repo's reviewed source has no upstream release to wait for; its review happens at merge. Forcing a 14-day wait on it would block our own fixes and protect nothing.

The exemption is narrow. It is an explicit allowlist (not a pattern the code guesses), and it removes only the date rule. The digest pin still applies, so what runs is exactly the reviewed build. A first-party image that is not on the list, or is not pinned by digest, fails.

## CLAUDE.md

`CLAUDE.md` says "Only versions at least two weeks old." The owner should amend that line to mention the first-party exemption and the allowlist. Agents do not edit `CLAUDE.md`. Until the owner does, this record is the rule.

## Checkpoint manifest and shard config schemas

`contract/schemas/checkpoint-manifest.schema.json` and `contract/schemas/shard-config.schema.json` are added to the contract and generated.

- The checkpoint manifest has no producer or consumer yet. It is unused until the backup build (C1-05b) exists. The build and its destination are deferred by decision 0130 (on main; owner ruling 2026-11-10); the manifest waits for that build.
- The shard config schema describes the colo shard configuration. It is validated by the contract tests.

## Consequences

- A new pinned third-party image or package must carry a publish date in `release-dates.json`, or `pnpm check:repo` fails.
- A new first-party image needs its repository prefix in `first-party-images.json` and a digest pin.
- Adding an integration test file raises the count; the floor only needs changing when the count is raised on purpose.
