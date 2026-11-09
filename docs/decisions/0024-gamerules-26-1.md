# 0024. Gamerule names on Minecraft 26.1 are snake_case

- Status: Accepted
- Date: 2026-11-08
- Spec: section 5.1 (gamerules), section 13 item 2k

## Decision

On the pinned Paper 26.1.2 build, `compose/phase0.yml` sets the section 5.1 gamerules under their 26.1 names: `keep_inventory`, `immediate_respawn`, `show_advancement_messages`, `send_command_feedback`, `spectators_generate_chunks`. The values are the section 5.1 values. The camelCase names in section 5.1 are not valid on this version.

## Why

The P0-06 review ran the section 5.1 names against the live server and 26.1.2 rejected them. A failed startup command only logs an error, so the stack looked healthy while the rules were unset. The names were checked on the running stack and the values read back.

## Consequences

- Any code that sets or reads a gamerule (governance setters, the plugin) uses the 26.1 names. Section 13 item 2k already warns that names move between versions; check them against the pinned build before writing setters.
- The image splits `RCON_CMDS_STARTUP` on newlines, not commas; the compose file uses newlines.
