# 0243. Genesis drill preserves the world files and burns everything else

- Status: Accepted
- Date: 2026-11-21
- Spec: none; `docs/spec.md` is not edited
- Related: 0240 (the scorched-earth drill; point 5 is narrowed for the database by this record), 0242 (genesis includes NeoForge), 0188 (stamp architecture), `docs/analysis/genesis/packets.md` (GE-06, GE-09, GE-11)

## Context

The owner's ruling (2026-11-21), in the owner's words: "Preserve actual world files when doing the burn down but dump the rest of everything else."

0240 makes the drill delete every Geldar-owned thing and rebuild it from pipelines. 0242 left open whether the NeoForge world survives the drill. Today no backup of the NeoForge world exists (0240, fact). This record answers the world question for both shards and fixes the rule for the rest.

## Decision

1. **Preserved, in the scorched-earth drill (0240) and in a production rebuild:** the actual world files of each shard. That is the world save directory of the Paper shard and of the NeoForge shard, including the level data, `region`, `entities`, `poi`, `data` and dimension folders, and the player data, advancements and stats that live inside the world folder.
2. **Everything else is destroyed and regenerated** from the repo and the pipelines. That covers hosts, VMs, volumes other than the preserved world files, containers, networks, secrets, DNS, the Entra app, runners, the Postgres database and its data, NATS state, plugin and mod data folders (CoreProtect, BlueMap render output, Dynmap-style caches) and logs.
3. **The preserved set is a list in the repo,** `deploy/genesis/world-files.list`, created by GE-06. Nothing is preserved by accident: a file that is not on the list is not copied and is not restored.

## Consequences (stated honestly)

a. **Backup before the burn.** The world files are copied off the host to the backup destination before the burn (GE-06), with a checksum manifest. The copy is verified. After the rebuild they are restored into the new environment before the first server start. A restore that fails any checksum is refused.

b. **The database is not preserved.** Anything that lives only in the database is regenerated or lost: player accounts and registration, the ledger, agent memory, thought history, the roster and the CoreProtect logs. So the drill needs the registration and roster flows to rebuild accounts. Agent identity data is lost unless a separate decision keeps it. This narrows 0240 point 5, which said Postgres restores from the off-host backup during the drill; this record is the owner's ruling for the burn and supersedes that point for the database.

c. **World files must still load.** A world file can embed references to things the burn removes, such as player UUIDs of accounts, ledger or whitelist references. Those must still load. The verify step is that both servers start on the restored world and a ranger can join.

d. **Open owner question (not decided here):** which database-resident data, if any, must survive the burn. Until the owner rules, no database data is preserved by this decision.

## Not decided

- Which database-resident data, if any, must survive the burn (see consequence d).
- The backup destination and its credential. Both are the owner's open items; the credential is write-only.

## Why

The world files are the one part of the stack that the repo cannot regenerate: the builds and the terrain players have made. Everything else either regenerates from the repo or is covered by its own backup. A written list makes the preserved set reviewable and testable.
