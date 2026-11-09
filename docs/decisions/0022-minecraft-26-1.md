# 0022. Minecraft 26.1 and the pinned body stack

- Status: Accepted (owner, 2026-11-08)
- Date: 2026-11-08
- Spec: section 5.1 (version pinning), section 5.2

## Decision

The world runs Minecraft **26.1**, pinned as this combination:

| Part | Pin | Why this one |
|---|---|---|
| Minecraft / Paper | **26.1.2**, Paper build **74** (STABLE, 2026-07-06) | Paper publishes no plain 26.1; 26.1, 26.1.1 and 26.1.2 share protocol 775 (minecraft-data), so this is the protocol Mineflayer tests |
| Java | **25** | required by Minecraft 26.1 |
| Velocity (bot ingress) | **3.5.1**, build **615** (RECOMMENDED, 2026-07-11) | current stable line; P0-06 confirms it forwards protocol 775 |
| Mineflayer | **4.39.0** | its `testedVersions` ends at `26.1` |
| minecraft-data | **3.117.0** | newest release at least two weeks old with 26.1 data |
| mineflayer-pathfinder | **2.4.5** | the only release line; see the risk below |

Images (`itzg/minecraft-server`, `itzg/mc-proxy`) are pinned by digest at dispatch of P0-06, at the newest tags at least two weeks old that run these versions.

## Why

The owner chose 26.1 over 1.21.11 to track the current game. Mineflayer tests 26.1 directly.

## Risk and what we do about it

`mineflayer-pathfinder` hasn't released since 2023 and isn't tested against 26.1. Packet P0-07's smoke test and the wave 2 benchmark are where that shows: digging, pathing, swimming and eating. If they misbehave, that's a finding for the owner, with a new record superseding this one; we don't switch versions quietly.
