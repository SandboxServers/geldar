# 0242. Genesis includes NeoForge

- Status: Accepted
- Date: 2026-11-20
- Spec: none; `docs/spec.md` is not edited
- Related: 0240 (the scorched-earth drill), 0241 (bootstrap scope cut), 0386, 0387, 0388 (the NeoForge shard), `docs/runbooks/node-only-config.md`, `docs/analysis/genesis/packets.md` (GE-06, GE-11)

## Context

The owner's ruling (2026-11-20), in the owner's words: "NeoForge must be included in genesis."

The NeoForge shard is built by 0386 to 0388 and runs as the compose project `geldar-nf` on the colo node. Its mod and config folders are hand-staged on the node, as the node-only configuration runbook records. The 0240-era remark that NeoForge handling was open is overridden by this record.

## Decision

1. The NeoForge shard is a first-class part of genesis. It is part of every stamp: the production rebuild, a second environment, and the ephemeral CI stamp.
2. The NeoForge shard is part of the scorched-earth drill in 0240. The drill deletes it with the other Geldar-owned things and rebuilds it from pipelines. The human lane (`geldar-nf`) is touched only with the separate approval that 0240 point 9 requires.
3. A stamp covers the NeoForge shard in full:
   - the NeoForge server image or install;
   - the mod and config folders, which are hand-staged on the node today and come from the repo, with hashes;
   - the plugin or mod jars and their hashes;
   - the startup commands and gamerules;
   - the connection to Velocity;
   - world backup and restore.
4. The rules of 0240 apply to the NeoForge shard: no hand-placed artifact, no manual node step, and drift is reported.

## Not decided

- Whether the drill must preserve the NeoForge world content, or may regenerate it. This is an open owner question. It is part of the backup and restore design in GE-06, which does not exist yet: today no backup or restore of the NeoForge world exists. Until the owner rules, neither answer is the decided behaviour.

## Consequences

- GE-11 (`packets.md`) owns the NeoForge stamp: the environment schema field for the NeoForge shard, the mod and config folders from the repo with hashes, the startup commands, and a smoke test that a NeoForge player can join. GE-11 depends on GE-06 for the world.
- GE-06 covers the NeoForge world backup and restore. Its scope is decided only when the owner rules on the open question above.
- Nothing in this record changes a secret, a key or an account. It records no values, addresses or account names.
