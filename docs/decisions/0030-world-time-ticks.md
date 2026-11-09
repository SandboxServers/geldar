# 0030. `world_time.ticks` is the world age; a biome the server does not name is omitted

- Status: Accepted
- Date: 2026-11-09
- Spec: section 5.2 (snapshot), Appendix C (`expires_tick`); packet P0-07b

## Decision

1. In a snapshot, `world_time.ticks` is the world age in ticks (`bot.time.age`), and `world_time.day` is `floor(age / 24000)`. `time_of_day` is derived from the time of day (`bot.time.timeOfDay`, 0 to 23999).
2. `self.position.biome` is present only when Mineflayer returns a name that matches the contract pattern. On 26.1 the block lookup returns an empty name for the biome id, so the field is omitted rather than guessed.

## Why

- The spec says `ticks` without defining it. Plans and events carry `expires_tick`; a monotonic clock is comparable with them, while the time of day wraps every 24000 ticks. Live check on the local shard: `bot.time.age` was 23658 and `bot.time.timeOfDay` was 6000, so the two differ.
- The contract requires `^[a-z_]{1,64}$` for `biome` and treats the field as optional. Omitting is honest; inventing a name would put false data in front of the Mind.

## Consequences

- Anything that compares `ticks` with `expires_tick` uses the world age.
- If a later Mineflayer or minecraft-data release names 26.1 biomes, the snapshot picks them up with no contract change.
