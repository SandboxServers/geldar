# 0187: A BlueMap skin provider in geldar-core

- Status: Proposed (owner to accept)
- Date: 2026-11-14
- Relates to: 0140 (nothing new goes into Paper or geldar-core; agent skins are served by Glass), 0195 (grave records, same deploy)
- Packet: GX-07 (phase 1)

## Context

BlueMap shows a player's head on the live map from its skin provider. For a real player it downloads the skin from Mojang by UUID. Our agents have offline UUIDs with no Mojang profile, so the download finds nothing and the map shows the default head. The skins that exist are the PNGs Kino serves (`<agent_id>.png`, mounted read-only into Glass from `compose/secrets/kino-skins`). Decision 0140 kept new code out of Paper and geldar-core, so the only route to the map was the generated `playerheads/<uuid>.png` files written by `skin heads`. Those files go stale and are not kept in step with the skins.

The owner chose a skin provider in geldar-core (option B) in this session, relayed through geldar-93.

## Decision

- This reverses the line of 0140 that nothing new goes into Paper or geldar-core, for this one case. The owner chose option B (a skin provider in geldar-core) in this session, relayed through geldar-93. Nothing else in 0140 changes.
- geldar-core registers a BlueMap skin provider (`dev.geldar.core.skins`, `AgentSkinSetup`, `AgentSkinProvider`, `AgentSkinLookup`). It runs only when BlueMap is present (`softdepend`). It builds the lookup from the Paper UUID of an agent and reads `<agent_id>.png` from the directory in `GELDAR_AGENT_SKINS_DIR` (default `/data/skins`).
- The provider never returns an empty skin. BlueMap deletes a player's head file when the provider returns an empty result, so a missing, unreadable, corrupt, oversized or wrong-sized PNG yields a bundled default image. The log names only the UUID.
- The provider writes no files. The directory is mounted read-only into the Paper container (`compose/colo.yml`, source `./secrets/kino-skins`, never created by compose).
- BlueMap's API is pinned to `de.bluecolored:bluemap-api:2.8.2`. That is the API artifact that `bluemap-core` 5.29 depends on. No 5.29 API artifact exists, so the pin is 2.8.2.

## What stays outside Paper and geldar-core

- The skin PNG files. Kino and the operator put them in `compose/secrets/kino-skins`; the plugin only reads them.
- The upload path (`skin set`, `skin import`) and the BlueMap web-root generator (`skin heads`, which writes `playerheads/<uuid>.png`) stay in the tools.
- The BlueMap jar, its config (`plugins/bluemap/config/plugin.conf`) and the web server stay as they were, apart from the provider.
- The default skin is a PNG generated locally for this change. It is not a Mojang asset.

## Consequences

- The geldar-core jar is rebuilt (`plugin/core`, Gradle). The build pins the BlueMap API and adds the `softdepend`.
- The Paper service gets a new read-only mount and the `GELDAR_AGENT_SKINS_DIR` variable. Precondition: the directory `compose/secrets/kino-skins` must exist on the node before Paper starts. The mount sets `create_host_path: false`, so compose does not create it, and Paper fails to start without it. Open item for geldar-93: the deploy script creates the directory (mkdir) or the owner does. This change does not edit `deploy/`. The Phase 0 Paper service has no BlueMap mount and is unchanged.
- The deploy window is the one from geldar-93. A Paper restart needs the owner's approval; this change is not deployed without it.
- Existing `playerheads/<uuid>.png` files are replaced at the next join of each agent.
- One restart carries this change and the grave-record jar (0195). They are deployed together, not in two restarts.
- If BlueMap does not call the provider when downloads are on, the provider is inert and the old heads stay. The runbook says to report this before any config change.
- BlueMap calling the provider when `skin-download` is `true` is UNVERIFIED until the live check after the Paper restart.
- The provider is not covered by a live test on the node. The unit tests cover the lookup, the adapter, and the setup's default-skin fallback and no-throw path; the BlueMap-enabled registration needs the BlueMap runtime and is not unit-tested. The map itself is checked live.
