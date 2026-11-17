---
title: "Map chat panel: manual node steps"
type: how-to
audience: agents-never
status: draft
last_verified: 2026-11-17 against the BM-16c change (node procedure in section 2a)
companions: [README.md, node-only-config.md, glass-aliases.md]
sources: [../decisions/0310-live-chat-panel-on-the-map.md, ../decisions/0197-speech-bubbles-on-the-map.md, compose/colo.yml, compose/bluemap-web/Caddyfile, deploy/genesis/config-bundle.list, docs/analysis/bluemap/settings-deploy-design.md]
---

# Map chat panel (decision 0310): manual node steps

The panel shows agents' chat on the public map. Step 1 restarts Paper: it needs the owner's approval, given through the
orchestrator. Nothing here restarts the shared production Caddy. The node's Caddyfile is changed in place (section 2a);
the Paper volume gets one hand copy, the pinned `settings.json` (section 2a).

> **WARNING: do NOT run `docker compose` against the node's `compose/colo.yml` until its drift from `main` is reconciled.**
> The node's file has drifted from main: literal project and network names, a different Paper cap, literal ports and a
> missing gamerule. Compose wants to recreate the shared `colo` network, and on 2026-11-17 that failed with "active
> endpoints". Until the drift is reconciled in the repo, no `dc` or `docker compose` command runs on the node. Every node
> change in this runbook is a hand copy, an in-place overwrite, or `docker restart bluemap-web`. The design is in
> `docs/analysis/bluemap/settings-deploy-design.md`.

## 1. Replace the geldar-core jar and restart Paper (owner approval)

1. From the repo root build the jar: `cd plugin; ./gradlew build`. Keep the jar the node runs now as the rollback copy.
2. Replace the geldar-core jar on the node through the normal geldar-core deploy, then restart Paper.
3. After the restart, the plugin deletes the old `geldar-speech` marker set from every map. It writes
   `geldar-chat.json` into the BlueMap web root once an agent speaks.

The feed now carries a clock: `"clock":{"time":..,"at":..}`, the overworld's time of day (0 to 23999 ticks) and the
epoch milliseconds at which that time was sampled (once a second, on the main thread), with no other data. The file is rewritten at least every 10 seconds, even with no new chat.
This needs the new geldar-core jar and a Paper restart, so batch it with other plugin changes. Older page scripts ignore
the `clock` key.

## 2. Web files: change a file in place (no compose)

The page's web files are single-file bind mounts that the node already has in its `bluemap-web` service:
`plugins/bluemap/web/geldar-chat.js` (the chat panel, decision 0310), `plugins/bluemap/web/geldar-sky.js` (the time-of-day
dial, BM-15) and `plugins/bluemap/web/geldar.css` (the stylesheet). None of them needs a new mount, a new settings entry
or a compose change. Their `scripts` and `styles` entries are in the pinned `settings.json` (section 2a).

To change one of the three (for example after BM-11 or BM-15 edits):

1. Copy the current file aside first, with `cp -p`, so the mode is kept.
2. Overwrite it in place: `cat new-file > plugins/bluemap/web/geldar-chat.js`. Never `mv`, never `cp` over it through a
   rename, never `sed -i`: the bind mount must keep the same inode.
3. `docker restart bluemap-web`. Same container, same networks, mounts and ports. Expect a few seconds of downtime on the
   public map.
4. Verify: `curl -sI http://127.0.0.1:8100/assets/geldar-chat.js` returns `HTTP/1.1 200` and
   `Content-Type: text/javascript; charset=utf-8` (the same for `geldar-sky.js`, and `text/css` for `geldar.css`).
5. Reload the public map page once.

Rollback: write the copied-aside file back in place the same way, then `docker restart bluemap-web`.

## 2a. Pinned settings.json (BM-16c): node procedure

BlueMap rewrites the webroot's `settings.json` on every Paper and BlueMap start, and it writes `"scripts": []` and
`"styles": []`. The public site must not read that file. `GET /settings.json` is served from `geldar-settings.json`, a copy
of the repo's pinned file that is hand-copied into the webroot. Caddy reads it from `/srv`; if the copy is missing, Caddy
serves BlueMap's own `settings.json` (the page then loads without scripts and styles, and never 404s).

Facts for this procedure: the pinned file is `plugins/bluemap/web/geldar-settings.json`, 542 bytes, sha256
`a3750e6eda6e4a52289c2d8fdd6cd21315b049d89641e0da033e44eea2161f69`. The webroot is the `bluemap/web/` directory of the
`paper-data` volume, the one `bluemap-web` mounts read only at `/srv`. The new Caddyfile is `compose/bluemap-web/Caddyfile`
from `main` (the config bundle ships it). Run the steps in the node's checkout, with the webroot path set in `$WEBROOT`.
Nothing here needs compose, and nothing restarts Paper or the shared Caddy.

1. Pre-check: compare the webroot's `settings.json` with the pinned file, with `scripts` and `styles` removed from both
   (`jq -S` sorts the keys, so the order does not matter):
   ```
   diff <(jq -S 'del(.scripts,.styles)' "$WEBROOT/settings.json") <(jq -S 'del(.scripts,.styles)' plugins/bluemap/web/geldar-settings.json)
   ```
   Empty output is expected. Any difference means BlueMap's output changed (a BlueMap upgrade, or a map added or removed
   under `config/maps/`). Stop: the pinned file must be updated in the repo first (the upgrade check in
   `plugins/bluemap/README.md`), then this section starts again from step 1.
2. Back up the node's Caddyfile, and record its inode: `STAMP=$(date -u +%Y%m%dT%H%M%SZ)`,
   `cp -p compose/bluemap-web/Caddyfile compose/bluemap-web/Caddyfile.bak-$STAMP`, `stat -c %i compose/bluemap-web/Caddyfile`.
3. Hand-copy the pinned file into the webroot: `cat plugins/bluemap/web/geldar-settings.json > "$WEBROOT/geldar-settings.json"`,
   then give it the owner and mode of the webroot's `settings.json` (`chown --reference` and `chmod --reference`).
   Check: `sha256sum "$WEBROOT/geldar-settings.json"` is `a3750e6e...161f69`, and the size is 542 bytes.
4. Stage the new Caddyfile as `compose/bluemap-web/Caddyfile.new` (copy main's file there). Validate it in a throwaway
   container of the same caddy image, with nothing from the node mounted except this file, read only, on the default network:
   `docker run --rm -v "$PWD/compose/bluemap-web/Caddyfile.new:/etc/caddy/Caddyfile:ro" <caddy image> caddy validate --config /etc/caddy/Caddyfile`.
   It needs no other mount: the Caddyfile reads the pinned copy from `/srv`, which validate does not open. Do not go on
   unless validate prints "Valid configuration".
5. Write the new Caddyfile in place: `cat compose/bluemap-web/Caddyfile.new > compose/bluemap-web/Caddyfile`. Never `mv`,
   never `cp` over it through a rename, never `sed -i`. Check that `stat -c %i compose/bluemap-web/Caddyfile` equals the
   inode from step 2, and that `docker exec bluemap-web sha256sum /etc/caddy/Caddyfile` equals `sha256sum compose/bluemap-web/Caddyfile.new`.
   Then remove `Caddyfile.new`.
6. `docker restart bluemap-web`. Same container, same networks, aliases, mounts and ports. `caddy reload` is not possible
   because the Caddyfile has `admin off`. Expect a few seconds of downtime on the public map.
7. Verify, against `http://127.0.0.1:8100` (the container must be healthy within 20 seconds of the restart, or roll back):
   - `curl -s http://127.0.0.1:8100/settings.json | cmp - plugins/bluemap/web/geldar-settings.json` prints nothing.
   - `curl -sI http://127.0.0.1:8100/settings.json` shows `content-type: application/json` and `cache-control: no-cache`.
   - `curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:8100/settings.json` prints `405`.
   - `curl -sI` for `/assets/geldar-chat.js`, `/assets/geldar-sky.js`, `/assets/geldar.css` and `/geldar-chat.json` each return 200 (the feed may be 404 before any agent speaks).
8. Hand step, not automated: prune the old `settings.json.bak-*` files in the webroot (`bluemap/web/` on the Paper volume).
   List them first with `ls -l "$WEBROOT"/settings.json.bak-*` (about 8 at the time of writing), keep the newest, and
   delete the rest by hand. The public site does not read them.

**Rollback (BM-16c).** Write the saved Caddyfile back in place the same way as step 5 (`cat compose/bluemap-web/Caddyfile.bak-$STAMP > compose/bluemap-web/Caddyfile`,
then the inode and sha256 checks), then `docker restart bluemap-web`, then re-verify the URLs in step 7. The webroot copy
may stay: nothing references it then. Use the same rollback if the container is not healthy within 20 seconds.

The pinned copy holds the BlueMap 5.29 keys, the chat panel and dial scripts, and the stylesheet: `"scripts": ["assets/geldar-chat.js", "assets/geldar-sky.js"]` and `"styles": ["assets/geldar.css"]`. `version` must equal both
`bluemap.lock.json` `version` and `known-keys.json` `bluemap`; `maps` must list the `config/maps/*.conf` names in the order of
their `sorting:` values; `mapDataRoot` and `liveDataRoot` must be `maps`, and `clientDecompression` must be `false`.
`plugins/bluemap/test/settings-pin.test.ts` checks all of these.

## 3. Checks (curl against the loopback port 127.0.0.1:8100)

Run before step 1 and again after step 2. Compare the `players.json` body before and after: it must be unchanged.

- `curl -sI http://127.0.0.1:8100/assets/geldar-chat.js`: 200, `Content-Type: text/javascript`.
- `curl -s http://127.0.0.1:8100/geldar-chat.json | python3 -m json.tool`: valid JSON, `"v": 1`, at most 100 lines.
  Before any agent speaks the file may be absent: that is a 404, not an error.
- `curl -s http://127.0.0.1:8100/maps/overworld/live/markers.json | grep -c geldar-speech`: 0 after step 1.
- `curl -s http://127.0.0.1:8100/maps/overworld/live/players.json`: the names are aliases, never an `ag_` username.
- `curl -s http://127.0.0.1:8100/settings.json | grep -o 'assets/geldar-\(chat\|sky\)\.js' | wc -l`: 2. `grep -o` prints
  each match, so the one-line `scripts` array counts 2; `grep -c` counts lines and would give 1.
- After every BlueMap restart, the `settings.json` check above still returns 2: the public site reads the pinned copy, so
  BlueMap's regenerated copy does not matter.
- `curl -s http://127.0.0.1:8100/geldar-chat.json | grep -c 'ag_'`: 0. The feed holds no agent username; speech text has
  them replaced with `Ranger`.
- Follow (BM-11): click a speaker's name in the panel. The camera follows that agent (its marker is the followed one, and the name gets the `gc-following` highlight). A second click stops the follow, and dragging the map cancels it and clears the highlight. An agent not on the map shows "Not on the map" for 3 s.
- Follow world time: with a feed that carries `clock`, the overworld's night matches the world's time (dim at night, full light by day), and the nether and end stay at full light. Pressing BlueMap's day/night button turns this off until the "Follow world time" button under the list is pressed. The button is `<div class="svg-button day-night-switch thin-hide" title="Day/Night">` in BlueMap 5.29 (tabindex -1, not a button, hidden on thin screens), so only a click turns it off; keyboard activation does not. A clock that has not changed for 60 s is ignored, and a sunlight value that differs by more than 0.01 from the page's last write also turns it off. A feed without `clock` (an older plugin) changes nothing.
- Panel visible: open the public map. A "Chat" panel sits at the right edge below BlueMap's control bar (bottom, left of the zoom buttons, on a narrow screen). After an agent
  speaks, its line appears within about 4 seconds (1 s write flush plus 3 s poll), with an alias name and no coordinates.
- Dial visible (BM-15): a small sun or moon dial sits under BlueMap's control bar on the overworld. On a wide screen it
  is at the top right, left of the chat panel; on a phone it is at the top right, and the chat panel is at the bottom.
  It takes no map click, and its accessible name reads `World time HH:MM, Day` or `Night`.

## Shipped versus node-only drift

The repo is the source of truth. The node's `compose/colo.yml` and `compose/bluemap-web/Caddyfile` are a hand-synced copy,
and `colo.yml` also holds node-only values (`docs/runbooks/node-only-config.md`). After any change to the Caddyfile in
the repo, apply the same change on the node in place (section 2a). Do not copy main's `colo.yml` over the node's file.
Then check the drift. Run it where `origin/main` is available (the desktop checkout; if the node has no git history, copy the
node's two files to a temp directory there and compare them). The bluemap-web block should match; any difference must be
a named node-only value. These commands only read.

```
diff <(git show origin/main:compose/colo.yml | sed -n '/^  bluemap-web:/,/^  players-host:/p') \
     <(sed -n '/^  bluemap-web:/,/^  players-host:/p' compose/colo.yml)
diff <(git show origin/main:compose/bluemap-web/Caddyfile) compose/bluemap-web/Caddyfile
```

Empty output means the copies match. Until the `colo.yml` difference is reconciled in the repo (it is the compose drift in
the warning above), the first command differs on purpose.

## Rollback

1. Restore the previous geldar-core jar and restart Paper (owner approval).
2. The public site reads the pinned `geldar-settings.json` in the webroot (BM-16c), not BlueMap's `settings.json`. To take the scripts off the page,
   roll the Caddyfile back (section 2a, from the `.bak-<stamp>` copy) or remove the `scripts` entries from the pinned file in the repo.
3. Delete `geldar-chat.json` and `geldar-chat.json.tmp` (if present) from the BlueMap web root on the Paper volume.
4. Undo the Caddyfile change: copy the `.bak-<stamp>` Caddyfile from section 2a step 2 back in place (section 2a rollback),
   then `docker restart bluemap-web`. Do not run compose.

The bubbles return with the previous jar (decision 0197).
