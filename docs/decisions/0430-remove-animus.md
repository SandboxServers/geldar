# 0430. Remove animus: the live Mind is the scriptorium

- Status: Accepted (owner, 2026-11-22)
- Date: 2026-11-22
- Spec: this decision overrides the spec's mentions of animus as the Mind. The spec edit is the owner's and is pending; `docs/spec.md` is not changed here.
- Supersedes in practice: 0134 (Mind is a profile until a Thinker exists) and the animus placement in 0078 and 0083. Those records are history and are not edited.

## Context

The Mind of the live colo was the scriptorium. The `animus/` package (the Mind written in TypeScript, "Adam Mind") was never run anywhere: its compose service sat under the `mind` profile that `shard up colo` and `deploy/colo-up.sh` never named, and colo-cd listed it as never started. Keeping a dead package with its own workspace, lockfile, image job and dependency edges cost CI time and kept stale references alive.

## Decision

1. Remove the `animus/` package, including `animus/Dockerfile.mind`.
2. Remove the `mind` compose profile and the `animus` service from `compose/colo.yml`.
3. Remove the `geldar-mind` image job from `colo-images.yml`, its manifest entries (`GELDAR_MIND_IMAGE` in the release manifest, the digest loop and the summary row), and the `animus` mappings in `colo-cd` and `colo-cd-plan`.
4. Remove the `COPY animus` line from `tools/admin/Dockerfile`.
5. Remove the `@geldar/animus` dependency from `threshold/mcp`. Its tests that imported animus constants keep a local literal copy of the constant under test.
6. A repo guard test (`tools/repo-checks/src/no-animus.test.ts`) fails if an `animus/` directory with a `package.json`, or a workspace package named `@geldar/animus`, comes back.

## What stays

- `prompts/` stays. It holds the prompt templates the scriptorium and the tests read.
- The `nats-mind` secret and the `mind` NATS user stay in the nats-auth role table, and the role tests still expect them. No service mounts the secret. Removing them changes the NATS ACL table and is pending the owner.
- `docs/analysis/` and the past decision records stay as history. Mentions of animus in them are not corrected.

## Consequences

- No running service changes. Nothing that the colo runs started from `animus/`.
- The dead `GELDAR_MIND_IMAGE` key may still appear in old release manifests; `colo-up.sh` does not need it.
- Host-run Adam tooling (`tools/adam-run`, `tools/adam-cli`, `golem/test/live/adam-*`) is outside this decision and is handled by its own packet.
