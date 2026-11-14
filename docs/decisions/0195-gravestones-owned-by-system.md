# 0195: Gravestones are owned by the system

- Status: Proposed (owner to accept)
- Date: 2026-11-14
- Relates to: 0147 (gravestones hold no items), 0164 (goto never digs through protected work), 0165 (block ownership subjects)
- Packet: grave-records (phase 1)

## Context

A gravestone is a stone-brick block with a standing sign, placed where an agent character dies (decision 0147). The plugin places it, so no player placed it, and nothing in the owner record says so. Under 0165 a block with no record reads as world-generated, and the Body's goto (0164) may dig it. A gravestone is a memorial for a dead agent, so an agent must not dig it or build over it.

## Decision

- Each gravestone's two blocks are recorded as owned by the system, under the owner `geldar-system`. The stone is at the death position (x, y, z) and the sign is above it (x, y + 1, z).
- The owner name has no `#`. CoreProtect treats a name that starts with `#` as a non-player, and the owner must read as a real owner in the log. Hyphens are used.
- The record is written in two places: the cache and the `changed` event take effect at once, and the CoreProtect log (`logPlacement`) keeps the record after the overlay lapses. The CoreProtect write is the only lasting record.
- A console command, `geldar-backfill-graves`, records the gravestones already in loaded chunks. It finds a sign whose first line starts "Here lies" over stone bricks. Any other sign is skipped, including a player's sign that does not say "Here lies". Running it twice gives the same owners.
- The command runs only from the server console or RCON. A sender that is neither is refused. The plugin had no operator command to match, so the command has no permission node. The sender check is the whole gate.

## Consequences

- Agents cannot dig or overwrite a gravestone: the Body treats the system owner as protected, as it does any owner that is not the agent's own.
- An operator can still remove a gravestone from the Paper console. The protection stops agents, not operators.
- The overlay lasts 60 seconds. The cache entry lapses after that, so without the CoreProtect log a gravestone is unprotected again. The CoreProtect row is what makes the protection last.
- Without CoreProtect, graves are protected for 60 seconds only, then unowned. Such a node should be treated as unprotected for gravestones.
- The backfill covers loaded chunks only. A scan of unloaded regions, which would read the world files offline, is out of scope and needs its own decision.
- The Bukkit event path (the death listener) and the command's chunk iteration are not unit-tested, because the test suite has no Bukkit mock. They are covered through the pure seams: the recording function, the recorder and the backfill's selection logic.
- Gravestone material names are fixed in the plugin (`STONE_BRICKS`, `OAK_SIGN`). If the gravestone blocks change, this record and the backfill's test must change with them.
- The records are facts about placement only. No agent-facing text is involved.

## Later

- The backfill also accepts RCON (`rcon-cli`). The server console pipe is off on the Colo node, so RCON is the operator route there. RCON is as privileged as the console: its password sits in a mode-0600 service secret, and only the operator holds it. The check accepts the console and RCON senders and refuses every other sender, so the command stays operator-only and no player, command block or entity can run it.
