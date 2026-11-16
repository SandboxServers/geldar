---
title: Third-party plugins
type: reference
audience: operators
status: draft
last_verified: 2026-11-16 against 1b114276
companions: [README.md, geldar-core-plugin.md, ../runbooks/map-chat-panel.md, ../runbooks/chunky.md, ../runbooks/coreprotect.md, ../runbooks/block-owner.md, ../runbooks/glass-aliases.md, compose-stacks.md, deploy-scripts.md]
sources: [plugins/bluemap/README.md, plugins/bluemap/bluemap.lock.json, plugins/bluemap/known-keys.json, plugins/bluemap/config, plugins/bluemap/alias-proxy/alias-proxy.ts, plugins/bluemap/web, plugins/bluemap/test, plugins/chunky/README.md, plugins/chunky/chunky.lock.json, plugins/chunky/test/lock.test.ts, plugins/coreprotect/coreprotect.lock.json, plugins/coreprotect/test/lock.test.ts, deploy/common.sh, deploy/colo-up.sh, compose/colo.yml, tools/repo-checks/src/release-dates.json, plugin/core/src/main/resources/plugin.yml, docs/runbooks/coreprotect.md, docs/runbooks/chunky.md, docs/decisions/README.md]
---

# Third-party plugins

The three Paper plugins Geldar runs but does not build: BlueMap (the public map), Chunky (chunk pregeneration) and CoreProtect (block-change log, read for block ownership). For each: the pin, how the jar reaches Paper, what is configured and why, and which decision says so. `plugins/` holds 33 tracked files: BlueMap 28, Chunky 3, CoreProtect 2 (`git ls-files plugins | Measure-Object -Line` and per folder, 2026-11-16 at 1b114276).

Everything below was read from the files in `sources:` at commit `1b114276` on 2026-11-16. Nothing was read from the node (plan decision D8): what runs there is unverified.

Related: [Geldar-Core](geldar-core-plugin.md) soft-depends on BlueMap and CoreProtect (`plugin.yml`). See also [compose-stacks](compose-stacks.md) and [deploy-scripts](deploy-scripts.md).

## Pins

| Plugin | Version | Published | Source | Licence | Lock | Release-date key in `tools/repo-checks/src/release-dates.json` |
|---|---|---|---|---|---|---|
| BlueMap | 5.29, `bluemap-5.29-paper.jar`, 6336407 bytes | 2026-10-10T17:31:34Z | GitHub release `v5.29` of `BlueMap-Minecraft/BlueMap` | MIT | `plugins/bluemap/bluemap.lock.json` (url, sha256, size; no sha512) | `github-release:BlueMap-Minecraft/BlueMap@v5.29` |
| Chunky | 1.5.3, `Chunky-Bukkit-1.5.3.jar`, 304616 bytes | 2026-05-04T05:46:08Z | Modrinth project `fALzjamp` | GPL-3.0-only | `plugins/chunky/chunky.lock.json` (url, sha256, sha512, size) | `modrinth:fALzjamp@1.5.3` |
| CoreProtect CE | 24.1, `CoreProtect-CE-24.1.jar`, 1113283 bytes | 2026-09-24T00:00:00Z | Modrinth project `Lu3KuzdV` | Artistic-2.0 | `plugins/coreprotect/coreprotect.lock.json` (url, sha256, sha512, size) | `modrinth:Lu3KuzdV@24.1` |

Chunky and CoreProtect list Minecraft 26.1.2 (`minecraft_versions`; Chunky lists 26.1 to 26.3, CoreProtect 26.1.2 only); BlueMap states `minimum_paper_build` 26.1.1 and no `minecraft_versions`. The Paper pin is `26.1.2.build.74-stable` in `plugin/gradle/libs.versions.toml`. The 14-day minimum release age is a repo rule (`CLAUDE.md`); each `test/lock.test.ts` checks it with the release-date entry.

Re-derive: `Get-Content plugins/*/*.lock.json` and `Select-String -Path tools/repo-checks/src/release-dates.json -Pattern 'BlueMap|fALzjamp|Lu3KuzdV'`.

## How the jars reach Paper

| Step | What happens | Evidence |
|---|---|---|
| 1. Fetch | `deploy/colo-up.sh` calls `fetch_bluemap`, `fetch_chunky`, `fetch_coreprotect` in that order (`deploy/common.sh`). Each downloads the lock's `url` (https only; `file://` only in tests), checks the sha256, and stops the deploy on a mismatch. `check_lock_sha512` then checks the sha512 when the lock declares one. A missing lock skips that plugin. | `deploy/common.sh` lines 289 to 407 at 1b114276 |
| 2. Store | The verified jar goes to `bluemap/`, `chunky/` or `coreprotect/` under the node state directory. A dry run verifies and keeps nothing. | `deploy/common.sh` |
| 3. Mount | `compose/colo.yml` binds each stored jar read-only at `/plugins/bluemap.jar`, `/plugins/chunky.jar`, `/plugins/coreprotect.jar` in the `paper` service. BlueMap's `config/` is also mounted read-only at `/plugins/BlueMap`. | `compose/colo.yml` lines 144 to 148 |
| 4. Load | The Paper image copies `/plugins` into the server's plugin directory at start. | `plugins/bluemap/README.md` |

None of the three is in `compose/phase0.yml`; they run on the Colo stack only (inferred from `git grep -n 'bluemap.jar\|chunky.jar\|coreprotect.jar' -- compose`).

## BlueMap

### Why it runs

| Ruling or decision | What it requires |
|---|---|
| Decision [0072](../decisions/0072-glass-and-bluemap-are-public.md) | Glass and BlueMap are public, read-only, hardened before exposure. |
| Decision [0094](../decisions/0094-public-sites-read-only-through-caddy.md) | BlueMap is a read-only Caddy site with a kill switch. Its 2026-11-11 amendment covers the Mojang asset download (`core.conf` comment). |
| Decision [0096](../decisions/0096-public-topology-as-built.md) | The public topology as built: host Caddy, loopback publishes. |
| Ruling R38, 2026-11-11 | The integrated webserver is on, so the public map shows agents' live positions (`plugin.conf`, `webserver.conf` comments). |
| Owner ruling 2026-11-12 | Skin download from Mojang on (`plugin.conf` comment). |
| Decision [0187](../decisions/0187-bluemap-skin-provider-in-geldar-core.md) | Agent heads come from Geldar-Core's skin provider, not only from Mojang. |
| Decision [0310](../decisions/0310-live-chat-panel-on-the-map.md) | The live chat panel replaces the speech bubbles of decision [0197](../decisions/0197-speech-bubbles-on-the-map.md). |

### Configuration (`plugins/bluemap/config/`)

| File | Key | Value | Why (the file's comment unless marked) |
|---|---|---|---|
| `core.conf` | `accept-download` | `true` | Owner accepts the Mojang client-asset download (owner ruling 2026-11-11, C2-07o; decision 0094 amendment). Without it BlueMap renders no textures. |
| `core.conf` | `data` | `"bluemap"` | Render data directory, relative to the server directory. |
| `core.conf` | `render-thread-count` | `1` | The node is shared with a production server; `0` would start one thread per core and compete with the game tick. |
| `core.conf` | `full-update-interval` | `1440` | Minutes between full re-renders (the default). |
| `core.conf` | `region-file-check-interval` | `5` | Minutes (the default). |
| `core.conf` | `metrics` | `false` | bStats would call an outside server; off, so the map makes no outbound call. |
| `plugin.conf` | `live-player-markers` | `true` | R38: the public map shows all agents live. |
| `plugin.conf` | `skin-download` | `true` | Owner ruling 2026-11-12. Only the agent's UUID is sent to Mojang. |
| `plugin.conf` | player visibility keys | see the file | Player visibility keys: see the file. |
| `plugin.conf` | `player-render-limit` | `-1` | Never stop rendering updates for player count. |
| `webserver.conf` | `enabled` | `true` | Must stay on while the map shows live positions (R38). |
| `webserver.conf` | `webroot` | `"bluemap/web"` | The subpath `bluemap-web` serves read-only. |
| `webserver.conf` | `port` | `8101` | The port the `bluemap-web` live proxy targets; never published to the host. BlueMap 5.29 has no bind-address key. |
| `maps/overworld.conf`, `nether.conf`, `end.conf` | `world`, `dimension` | `"world"`; overworld, the nether, the end | The three dimensions of the one Paper world (C2-07o). |
| each map file | `marker-sets` | empty | No entity markers and no agent markers. |

Each map file also sets render options (`sky-color`, `ambient-light`, `remove-caves-below-y`, views, `storage: "file"`); read them in the file. `plugins/bluemap/known-keys.json` lists the top-level keys of the 5.29 defaults; `test/config.test.ts` fails on a committed key that is not among them, because BlueMap ignores unknown keys silently.

### What sits around it (in this folder)

| Path | Role | Runbook |
|---|---|---|
| `alias-proxy/alias-proxy.ts` | Service `bluemap-alias`: display aliases (runbook glass-aliases). | [glass-aliases](../runbooks/glass-aliases.md), [map-chat-panel](../runbooks/map-chat-panel.md) |
| `web/geldar-chat.js`, `web/geldar.css` | The chat panel: reads `geldar-chat.json` (written by Geldar-Core) and the public `players.json`, shows lines as text only. | [map-chat-panel](../runbooks/map-chat-panel.md) |
| `web/geldar-sky.js` | The time-of-day dial; reads only the feed's clock. | [map-chat-panel](../runbooks/map-chat-panel.md) |

Caddy serves the tiles and these assets from the `bluemap-web` service and proxies only `/maps/<map>/live/<file>` (GET and HEAD) (`plugins/bluemap/README.md`; `compose/colo.yml`).

### Tests

`plugins/bluemap/test/`: `lock.test.ts` (pin), `config.test.ts` (every rule in the configuration table, no IPv4 address, no secret), `alias-proxy.test.ts` and `alias-format.test.ts`, the `chat-*.test.ts` panel tests, `geldar-sky.test.ts`, `sky-css.test.ts` and `sky-wiring.test.ts` (which also reads `docs/runbooks/map-chat-panel.md`). They run in `pnpm test` (Vitest).

## Chunky

| Item | Value | Evidence |
|---|---|---|
| Purpose | Pregenerates world chunks so a first visit does not stall the server. | `plugins/chunky/README.md` |
| Decision | None found: `grep -li chunky docs/decisions/*.md` matches only 0351 (the scope of a Paper telemetry plugin, which may make no mutating Chunky call). | 2026-11-16 at 1b114276 |
| Configuration in the repo | None. Chunky writes `plugins/Chunky/config.yml` in the writable Paper volume; it is not a repo path and not a mount. Keys that matter (`continue-on-restart`, `force-load-existing-chunks`, `silent`, `update-interval`) are named in the runbook. | [chunky runbook](../runbooks/chunky.md) |
| Load control | No thread setting in the jar: small radius, steps, `chunky pause` and `continue`, and the Paper CPU cap. BlueMap's `render-thread-count: 1` must not be raised to speed a run. | [chunky runbook](../runbooks/chunky.md) |
| Tests | `plugins/chunky/test/lock.test.ts`; `deploy/test/colo-chunky.test.ts` | `plugins/chunky/README.md` |

Chunky runs from the server console or RCON ([chunky runbook](../runbooks/chunky.md)). No decision record covers pregeneration as a world operation, and [world-operations-exceptions](../concepts/world-operations-exceptions.md) does not mention Chunky (checked 2026-11-16); that page is where the question belongs.

## CoreProtect

| Item | Value | Evidence |
|---|---|---|
| Purpose | Logs block changes; Geldar-Core reads the log to answer who placed a block (API 12, a soft dependency) and writes the system's own placements (gravestones). | decision [0165](../decisions/0165-block-owner-subjects.md); `BlockOwnerSetup` |
| Decisions | [0165](../decisions/0165-block-owner-subjects.md) (CoreProtect is the owner record); [0164](../decisions/0164-goto-digs-and-builds-its-way.md) (goto never digs protected work; the record starts when CoreProtect started recording); [0195](../decisions/0195-gravestones-owned-by-system.md) (gravestones owned by the system); [0219](../decisions/0219-decayed-farmland-is-not-ownership.md) (decayed farmland). | decisions index |
| Recording start | 2026-11-13 16:30Z; blocks placed earlier have no record. Unverified here; stated in decision 0164. | decision 0164 |
| Configuration in the repo | None. CoreProtect writes `plugins/CoreProtect/` in the writable Paper volume on first start; the operator then turns off chat, command, session and container-transaction recording, error reporting and update checks by hand. The runbook does not list the YAML keys. | [coreprotect runbook](../runbooks/coreprotect.md) |
| Data | CoreProtect's own store in the Paper volume. Not a repo path, not a mount. | [coreprotect runbook](../runbooks/coreprotect.md) |
| Tests | `plugins/coreprotect/test/lock.test.ts` | file list |
| Without it | Geldar-Core's owner queries answer unknown and system placements are not recorded. | `BlockOwnerSetup.sourceFor` |

## Retirement and reset

- Removing a plugin is a lock removal: the fetch step skips a plugin with no lock (`deploy/common.sh`), and the compose mount must go with it.
- Each plugin's data lives in the Paper volume (`bluemap/` render data, `plugins/Chunky`, `plugins/CoreProtect`). A world reset that keeps the volume keeps them; what the reset runbook does with them is for the [world-and-memory-reset](../runbooks/world-and-memory-reset.md) runbook.
- CoreProtect's log is the ownership record. Losing it makes every block's owner unknown (decision 0165).

## Conflicts recorded

1. **BlueMap shows agents.** `plugins/bluemap/README.md` line 5: "It is not a live view of the agents: the map shows terrain only." The same README (configuration section), `plugin.conf` (`live-player-markers: true`, ruling R38) and `config.test.ts` say the public map shows every agent's live position. The opening paragraph predates R38.
2. **CoreProtect sha512.** `docs/runbooks/coreprotect.md`: "The deploy checks only the sha256." `deploy/common.sh` line 399 calls `check_lock_sha512` for CoreProtect (and line 363 for Chunky), which fails the deploy on a sha512 mismatch.
3. **BlueMap README exposure section.** It says "Nothing in this directory opens a port" and that the map is served by Caddy from the webroot. `webserver.conf` turns on BlueMap's own webserver on port 8101 on the compose network. Both hold: no host port is opened; the README sentence is narrower than the configuration.

## Re-derive

```powershell
git ls-files plugins | Measure-Object -Line                          # 33 at 1b114276
Get-Content plugins/bluemap/bluemap.lock.json, plugins/chunky/chunky.lock.json, plugins/coreprotect/coreprotect.lock.json
git grep -n -E '^fetch_(bluemap|chunky|coreprotect)|check_lock_sha512 ' -- deploy/common.sh
git grep -n -E 'bluemap\.jar|chunky\.jar|coreprotect\.jar|/plugins/BlueMap' -- compose
```
