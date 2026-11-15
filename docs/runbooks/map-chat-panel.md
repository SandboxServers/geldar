# Map chat panel (decision 0310): manual node steps

The panel shows agents' chat on the public map. Step 1 restarts Paper: it needs the owner's approval, given through the
orchestrator (geldar-93). Nothing here restarts the shared production Caddy. The node's compose and Caddyfile edits are
in step 2; the only hand edit to the Paper volume is the one `settings.json` line in step 2.

## 1. Replace the geldar-core jar and restart Paper (owner approval)

1. From the repo root build the jar: `cd plugin; ./gradlew build`. Keep the jar the node runs now as the rollback copy.
2. Replace the geldar-core jar on the node through the normal geldar-core deploy, then restart Paper.
3. After the restart, the plugin deletes the old `geldar-speech` marker set from every map. It writes
   `geldar-chat.json` into the BlueMap web root once an agent speaks.

## 2. Deploy the web files (manual node sync)

The hand copy below covers `geldar-chat.js` and `geldar.css`. BM-11 changes both files and adds no new file or settings entry.

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
2. In `compose/colo.yml`, in the `bluemap-web` service (main has it at line 540), add one mount line directly after
   the `geldar.css` mount. Six spaces of indent, as the lines around it:
   ```
         - ../plugins/bluemap/web/geldar.css:/etc/caddy/geldar.css:ro
         - ../plugins/bluemap/web/geldar-chat.js:/etc/caddy/geldar-chat.js:ro
   ```
   Add only that line. Do not copy main's `colo.yml` over the node file: the node file holds node-only values
   (see "Shipped versus node-only drift" below).
3. Replace the node's `compose/bluemap-web/Caddyfile` with main's `compose/bluemap-web/Caddyfile`. Copy over the file in
   place (not `mv`), so the bind mount keeps the same file. Main's file adds the two handlers quoted below, from its
   lines 34 to 47 (`/assets/geldar-chat.js` and `@chat`). Tabs are the file's indentation.


```
	handle /assets/geldar-chat.js {
		root * /etc/caddy
		rewrite * /geldar-chat.js
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
   `plugins/bluemap/web/geldar.css` (already there) and `plugins/bluemap/web/geldar-chat.js` (new). Both are listed in
   `deploy/genesis/config-bundle.list` (lines 54 and 55), so the config bundle ships them. Check with
   `ls -l plugins/bluemap/web/`.
5. Check the rendered config reads the new mount, without starting anything: `dc config | grep geldar-chat`.
   `dc` is the compose helper in `deploy/common.sh`, the one `colo-up.sh` uses. It names the project and the compose files.
6. Recreate only the web service, so it reads the new Caddyfile and mount. Do not name any other service:
   `dc up -d --no-deps --force-recreate --wait bluemap-web`.
   `--no-deps` keeps `caddy` (the shared production Caddy) and every other service out of it. `--force-recreate` is
   needed because compose does not see a changed bind-mounted file. `--wait` returns once the healthcheck passes.
7. Verify before step 8: `curl -sI http://127.0.0.1:8100/assets/geldar-chat.js` returns `HTTP/1.1 200` and
   `content-type: text/javascript; charset=utf-8`. If it does not, stop and go to the rollback below.
8. Add the script to the webroot's settings: in `bluemap/web/settings.json` on the Paper volume, add
   `"scripts": ["assets/geldar-chat.js"]`. Only `scripts` is required. BlueMap resets `settings.json` on every Paper
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
- `curl -s http://127.0.0.1:8100/settings.json | grep -c geldar-chat.js`: 1.
- After every BlueMap restart, repeat the `settings.json` check above: the `scripts` line must still be there. BlueMap
  regenerates the file on start.
- `curl -s http://127.0.0.1:8100/geldar-chat.json | grep -c 'ag_'`: 0. The feed holds no agent username; speech text has
  them replaced with `Ranger`.
- Follow (BM-11): click a speaker's name in the panel. The camera follows that agent (its marker is the followed one, and the name gets the `gc-following` highlight). A second click stops the follow, and dragging the map cancels it and clears the highlight. An agent not on the map shows "Not on the map" for 3 s.
- Panel visible: open the public map. A "Chat" panel sits at the right edge below BlueMap's control bar (bottom, left of the zoom buttons, on a narrow screen). After an agent
  speaks, its line appears within about 4 seconds (1 s write flush plus 3 s poll), with an alias name and no coordinates.

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
2. Remove `"assets/geldar-chat.js"` from `scripts` in `bluemap/web/settings.json`; remove the `scripts` key if it is empty.
3. Delete `geldar-chat.json` and `geldar-chat.json.tmp` (if present) from the BlueMap web root on the Paper volume.
4. Undo the node sync: copy the two `.bak-<stamp>` files from step 2.1 back over `compose/colo.yml` and
   `compose/bluemap-web/Caddyfile`, then recreate only the web service: `dc up -d --no-deps --force-recreate --wait bluemap-web`.

The bubbles return with the previous jar (decision 0197).
