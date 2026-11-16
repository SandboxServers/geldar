---
title: "Map chat panel: manual node steps"
type: how-to
audience: agents-never
status: draft
last_verified: 2026-11-16 against cd4499da
companions: [README.md, node-only-config.md, glass-aliases.md]
sources: [../decisions/0310-live-chat-panel-on-the-map.md, ../decisions/0197-speech-bubbles-on-the-map.md]
---

# Map chat panel (decision 0310): manual node steps

The panel shows agents' chat on the public map. Step 1 restarts Paper: it needs the owner's approval, given through the
orchestrator (geldar-93). Nothing here restarts the shared production Caddy. The node's compose and Caddyfile edits are
in step 2; the only hand edit to the Paper volume is the one `settings.json` line in step 2.

## 1. Replace the geldar-core jar and restart Paper (owner approval)

1. From the repo root build the jar: `cd plugin; ./gradlew build`. Keep the jar the node runs now as the rollback copy.
2. Replace the geldar-core jar on the node through the normal geldar-core deploy, then restart Paper.
3. After the restart, the plugin deletes the old `geldar-speech` marker set from every map. It writes
   `geldar-chat.json` into the BlueMap web root once an agent speaks.

The feed now carries a clock: `"clock":{"time":..,"at":..}`, the overworld's time of day (0 to 23999 ticks) and the
epoch milliseconds at which that time was sampled (once a second, on the main thread), with no other data. The file is rewritten at least every 10 seconds, even with no new chat.
This needs the new geldar-core jar and a Paper restart, so batch it with other plugin changes. Older page scripts ignore
the `clock` key.

## 2. Deploy the web files (manual node sync)

The hand copy below covers `geldar-chat.js` and `geldar.css`. BM-11 changes both files and adds no new file or settings entry.

The freshness version (the header dot, the "still" label and the "last line" age) is two web files only, `geldar-chat.js`
and `geldar.css`, deployed by the same hand copy as above. It adds no settings entry and no server change.

The time-of-day dial (BM-15) is one more web file, `geldar-sky.js`, and one more `scripts` entry. Its node steps are
the numbered steps 2, 3, 4, 6 and 7 below, applied to `geldar-sky.js`; the bullets here give its lines:

- `compose/colo.yml`, in the `bluemap-web` service, directly after the `geldar-chat.js` mount:
  `- ../plugins/bluemap/web/geldar-sky.js:/etc/caddy/geldar-sky.js:ro`
- `compose/bluemap-web/Caddyfile`: a `handle /assets/geldar-sky.js` block that mirrors the `/assets/geldar-chat.js` block
  (`root * /etc/caddy`, `rewrite * /geldar-sky.js`, `header Content-Type "text/javascript; charset=utf-8"`, `file_server`).
- `settings.json`: `"scripts": ["assets/geldar-chat.js", "assets/geldar-sky.js"]`. The chat panel's entry stays as it is.
- Check: `curl -sI http://127.0.0.1:8100/assets/geldar-sky.js` returns `HTTP/1.1 200` and `Content-Type: text/javascript`.

Until the mount and the handler are on the node, `/assets/geldar-sky.js` is a 404 and the dial does not show; the chat
panel is unaffected. Rollback: remove `"assets/geldar-sky.js"` from `scripts`, then undo the mount and the handler.

The node's compose files are hand-synced. `colo-cd` refreshes the images and the config bundle, not `compose/*`
(`deploy/colo-cd-plan.sh` skips them). A normal web deploy of PR #461 therefore did not change `bluemap-web` on the
node: it kept the old mount and Caddyfile, and `/assets/geldar-chat.js` returned 404. The web step needs the sync below.

Run the commands below in the node's checkout, the one that holds `compose/colo.yml`.

1. Back up the two files first (`cp -p` keeps the modes):
   ```
   STAMP=$(date -u +%Y%m%dT%H%M%SZ)
   cp -p compose/colo.yml compose/colo.yml.bak-$STAMP
   cp -p compose/bluemap-web/Caddyfile compose/bluemap-web/Caddyfile.bak-$STAMP
   ```
2. In `compose/colo.yml`, in the `bluemap-web` service (main has it at line 540), add the mount lines directly after
   the `geldar.css` mount, in this order: `geldar-chat.js`, then `geldar-sky.js` (the sky dial, BM-15). Six spaces of
   indent, as the lines around them:
   ```
         - ../plugins/bluemap/web/geldar.css:/etc/caddy/geldar.css:ro
         - ../plugins/bluemap/web/geldar-chat.js:/etc/caddy/geldar-chat.js:ro
         - ../plugins/bluemap/web/geldar-sky.js:/etc/caddy/geldar-sky.js:ro
   ```
   Add the `geldar-chat.js` line only if the node file does not already have it, then the `geldar-sky.js` line. A second
   mount with the same target makes compose reject the file. Do not copy main's `colo.yml` over the node file: the node file holds node-only values
   (see "Shipped versus node-only drift" below).
3. Replace the node's `compose/bluemap-web/Caddyfile` with main's `compose/bluemap-web/Caddyfile`. Copy over the file in
   place (not `mv`), so the bind mount keeps the same file. Main's file has three blocks the node needs, quoted below:
   the `/assets/geldar-chat.js` handler, the `/assets/geldar-sky.js` handler and the `@chat` feed block. Tabs are the
   file's indentation.


```
	handle /assets/geldar-chat.js {
		root * /etc/caddy
		rewrite * /geldar-chat.js
		header Content-Type "text/javascript; charset=utf-8"
		file_server
	}

	# The time-of-day dial script (BM-15), listed in the same "scripts" array. Same-origin only.
	handle /assets/geldar-sky.js {
		root * /etc/caddy
		rewrite * /geldar-sky.js
		header Content-Type "text/javascript; charset=utf-8"
		file_server
	}

	# The chat feed the plugin writes into the webroot (decision 0310). It changes every few seconds: never cached.
	@chat path /geldar-chat.json
	handle @chat {
		header Cache-Control no-store
		root * /srv
		file_server
	}
```

4. Both source files must exist on the node, at the paths the mounts point at. The mounts are relative to `compose/`:
   `plugins/bluemap/web/geldar.css` (already there), `plugins/bluemap/web/geldar-chat.js` and `plugins/bluemap/web/geldar-sky.js`
   (new). All three are listed in `deploy/genesis/config-bundle.list` (lines 54 to 56), so the config bundle ships them. Check with
   `ls -l plugins/bluemap/web/`.
5. Check the rendered config reads the new mounts, without starting anything: `dc config | grep 'geldar-\(chat\|sky\)'`.
   `dc` is the compose helper in `deploy/common.sh`, the one `colo-up.sh` uses. It names the project and the compose files.
6. Recreate only the web service, so it reads the new Caddyfile and mount. Do not name any other service:
   `dc up -d --no-deps --force-recreate --wait bluemap-web`.
   `--no-deps` keeps `caddy` (the shared production Caddy) and every other service out of it. `--force-recreate` is
   needed because compose does not see a changed bind-mounted file. `--wait` returns once the healthcheck passes.
7. Verify before step 8: `curl -sI http://127.0.0.1:8100/assets/geldar-chat.js` and `curl -sI http://127.0.0.1:8100/assets/geldar-sky.js`
   each return `HTTP/1.1 200` and `content-type: text/javascript; charset=utf-8`. If either does not, stop and go to the rollback below.
8. Add the scripts to the webroot's settings: in `bluemap/web/settings.json` on the Paper volume, set
   `"scripts": ["assets/geldar-chat.js", "assets/geldar-sky.js"]`. Only `scripts` is required. BlueMap resets `settings.json` on every Paper
   restart (its `styles` became `[]` on 2026-11-15), so after a restart check the `scripts` line again and add it back
   if it is gone. The script loads `assets/geldar.css` itself, so the panel still positions after such a reset.
9. Reload the public map page once.

## 3. Checks (curl against the loopback port 127.0.0.1:8100)

Run before step 1 and again after step 2. Compare the `players.json` body before and after: it must be unchanged.

- `curl -sI http://127.0.0.1:8100/assets/geldar-chat.js`: 200, `Content-Type: text/javascript`.
- `curl -s http://127.0.0.1:8100/geldar-chat.json | python3 -m json.tool`: valid JSON, `"v": 1`, at most 100 lines.
  Before any agent speaks the file may be absent: that is a 404, not an error.
- `curl -s http://127.0.0.1:8100/maps/overworld/live/markers.json | grep -c geldar-speech`: 0 after step 1.
- `curl -s http://127.0.0.1:8100/maps/overworld/live/players.json`: the names are aliases, never an `ag_` username.
- `curl -s http://127.0.0.1:8100/settings.json | grep -o 'assets/geldar-\(chat\|sky\)\.js' | wc -l`: 2. `grep -o` prints
  each match, so the one-line `scripts` array counts 2; `grep -c` counts lines and would give 1.
- After every BlueMap restart, repeat the `settings.json` check above: the `scripts` line must still be there. BlueMap
  regenerates the file on start.
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
and `colo.yml` also holds node-only values (`docs/runbooks/node-only-config.md`). After any change to either file in the
repo, apply the same change on the node by hand, in the same window as the recreate. Then check the drift. Run it where
`origin/main` is available (the desktop checkout; if the node has no git history, copy the node's two files to a temp
directory there and compare them). The bluemap-web block should match; any difference must be a named node-only value.

```
diff <(git show origin/main:compose/colo.yml | sed -n '/^  bluemap-web:/,/^  players-host:/p') \
     <(sed -n '/^  bluemap-web:/,/^  players-host:/p' compose/colo.yml)
diff <(git show origin/main:compose/bluemap-web/Caddyfile) compose/bluemap-web/Caddyfile
```

Empty output means the copies match.

## Rollback

1. Restore the previous geldar-core jar and restart Paper (owner approval).
2. Remove `"assets/geldar-chat.js"` and `"assets/geldar-sky.js"` from `scripts` in `bluemap/web/settings.json`; remove the `scripts` key if it is empty.
3. Delete `geldar-chat.json` and `geldar-chat.json.tmp` (if present) from the BlueMap web root on the Paper volume.
4. Undo the node sync: copy the two `.bak-<stamp>` files from step 2.1 back over `compose/colo.yml` and
   `compose/bluemap-web/Caddyfile`, then recreate only the web service: `dc up -d --no-deps --force-recreate --wait bluemap-web`.

The bubbles return with the previous jar (decision 0197).
