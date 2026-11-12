# BlueMap (Paper plugin)

BlueMap renders the overworld of the colo shard's Paper world into static map tiles. It is the
public, read-only terrain map that decision 0072 requires ("BlueMap must be up on the Colo"). It
is not a live view of the agents: the map shows terrain only.

This directory holds the pin and the configuration. The jar is not in the repo.

## What is pinned

The pin lives in `bluemap.lock.json`. It is checked by `test/lock.test.ts`.

| Field | Value |
| --- | --- |
| Version | 5.29 (GitHub release `v5.29`, the newest release published on or before 2026-10-27) |
| Published | 2026-10-10T17:31:34Z (31 days before the pin; the 14-day floor is 2026-10-27) |
| Asset | `bluemap-5.29-paper.jar`, 6336407 bytes |
| URL | `https://github.com/BlueMap-Minecraft/BlueMap/releases/download/v5.29/bluemap-5.29-paper.jar` |
| SHA-256 | `7bf475936c26107d476c63151c76d5b49e865eebeada12c9e7d92155de877b9f` |
| Licence | MIT (the repo's `LICENSE` via the GitHub licence API). Permissive; no field-of-use limits. |
| Paper support | BlueMap's release table says Paper/Folia 26.1.1 to 26.3. The repo runs Paper 26.1.2 (`plugin/gradle/libs.versions.toml`, `VERSION: "26.1.2"` in `compose/colo.yml`). |

The SHA-256 is the digest GitHub publishes for the asset, and it matches a local `Get-FileHash`
of the downloaded jar. The release date is also recorded in
`tools/repo-checks/src/release-dates.json` under
`github-release:BlueMap-Minecraft/BlueMap@v5.29`, the same key family as the other pins.

To move to a newer release: pick the newest release at least 14 days old, update the lock file and
the date entry together, and rerun `test/lock.test.ts`.

## Configuration (`config/`)

These files are copied into the Paper plugin directory, `plugins/BlueMap/`, at deploy time.

- `core.conf`: `accept-download: true` (owner ruling 2026-11-11, see below), `metrics: false` (no outbound bStats ping),
  `data: "bluemap"`, `render-thread-count: 1` (one render thread: 0 starts one per CPU core, which
  competes with the game tick for the shared CPU cap).
- `webserver.conf`: `enabled: true`, `port: 8101` (ruling R38, 2026-11-11). The 5.29 defaults have no
  bind-address key (no `ip`; see `known-keys.json`), so the server listens on the container interface; it is
  reachable only on the colo network because Paper publishes no port. The `bluemap-web` caddy serves the tiles
  and proxies only `/maps/<map>/live/<file>` (GET and HEAD) to `paper:8101`.
- `plugin.conf`: `live-player-markers: true`, `hidden-game-modes: [spectator]`, `hide-vanished: true`,
  `hide-invisible: true` and `skin-download: true` (owner ruling 2026-11-12). The public map shows every agent player's live position
  (sovereign players included). Spectators (ghosts held by Paper, C2-02d), vanished and invisible players do not show.
  Exposed by the live JSON: player name, uuid, position, rotation, dimension. 5.29 has no plugin key for health or
  food and its players.json does not carry them as far as the pinned defaults show (not verified on a running server).
  BlueMap may fetch skins from Mojang's session server by player UUID so agent heads show; agents use offline-mode
  UUIDs Mojang does not know, so the fetch may fail harmlessly (fallback head: Steve). Only the UUID is sent, never a
  name or token.
- `maps/overworld.conf`, `maps/nether.conf`, `maps/end.conf`: the three dimensions of world `world` (C2-07o). Overworld: `dimension: "minecraft:overworld"`, world `world`, read from
  the Paper volume. The marker set is empty: no entity markers and no static markers.

No token, password, key, address or account name appears in these files. `test/config.test.ts`
checks that.

## The Mojang asset download (owner action)

BlueMap needs the Minecraft client assets (textures and models) to render blocks. On first run it
downloads them from Mojang's servers. That download is governed by Mojang's terms, so it is an
owner decision, not a default. Since 2026-11-11 (owner ruling, C2-07o) the repo ships with `accept-download: true`. With `false`, BlueMap would not
download anything and does not render textures.

No Mojang asset is committed to this repo. The owner must:

1. Read Mojang's terms for the client assets.
2. Done: `accept-download: true` is committed in `core.conf`, and `test/config.test.ts` fails if it is removed.
3. Record the acceptance in the deploy notes (owner action, 0130).

## How the jar reaches Paper (for C1-02 and C1-04)

1. At deploy, the deploy tooling reads `bluemap.lock.json`, downloads `url`, and checks the file's
   SHA-256 against `sha256`. A mismatch stops the deploy.
2. The verified jar is mounted read-only at `/plugins/bluemap.jar`. The itzg image copies `/plugins`
   into the server's `plugins/` directory on start, as it does for the Geldar jars.
3. This directory's `config/` is mounted read-only at `/plugins/BlueMap`.

The compose wiring is C1-02's (`compose/colo.yml`, slot for C1-09). This packet does not edit
compose.

## Exposure

BlueMap is not public by itself. The public map is served by Caddy in C2-04 from the rendered
webroot, read-only. Nothing in this directory opens a port.

## Private aliases and the head size (manual deploy steps)

Public map labels show a private alias, never the agent username. `bluemap-alias` (`alias-proxy/alias-proxy.ts`, a
plain Node script in the pinned node image) sits between the `bluemap-web` Caddy `@live` handler and Paper
(`paper:8101`). It rewrites each `name` in `live/players.json` from a private file and passes the other live files
through. Fail closed: no file, an invalid file, or a player without an alias gives the neutral label `Ranger`, never the
username; an unexpected upstream shape is a 502. UUIDs are unchanged (the offline UUID is still derivable from a name).
The username to alias mapping lives only on the node, never in the repo.

These changes touch compose and the Caddyfile, so the deploy plan reports `needs-manual`. Owner steps, in order:

1. Write `${GELDAR_STATE_DIR}/aliases/aliases.json` on the node, mode 0640: `{"<username>": "<alias>"}`. Never commit it.
2. `compose/colo.yml` mounts the directory `${GELDAR_STATE_DIR}/aliases` read-only into `bluemap-alias`, so no overlay is
   needed. Without the file every label is `Ranger`.
3. Start `bluemap-alias`, then recreate `bluemap-web` (new Caddyfile). Restarting the shared production Caddy is not
   needed for this; if it is, that needs owner approval first. Do not restart anything from a work packet.
4. Head size: `web/geldar.css` is served by `bluemap-web` at `/assets/geldar.css`. Add `"styles": ["assets/geldar.css"]`
   to `bluemap/web/settings.json` in the Paper volume. BlueMap regenerates that file on start; if the key is gone after
   a restart (unverified on 5.29), add it again and reload the page.
5. Check: `curl` the live `players.json` and confirm no `ag_` username appears.