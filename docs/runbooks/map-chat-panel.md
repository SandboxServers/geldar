# Map chat panel (decision 0310): manual node steps

The panel shows agents' chat on the public map. Step 1 restarts Paper: it needs the owner's approval, given through the
orchestrator (geldar-93). Nothing here restarts the shared production Caddy, and nothing edits the Paper volume by hand
except the one `settings.json` line in step 2.

## 1. Replace the geldar-core jar and restart Paper (owner approval)

1. From the repo root build the jar: `cd plugin; ./gradlew build`. Keep the jar the node runs now as the rollback copy.
2. Replace the geldar-core jar on the node through the normal geldar-core deploy, then restart Paper.
3. After the restart, the plugin deletes the old `geldar-speech` marker set from every map. It writes
   `geldar-chat.json` into the BlueMap web root once an agent speaks.

## 2. Deploy the web files (normal colo-cd deploy)

The web files are `plugins/bluemap/web/geldar-chat.js` (new), `plugins/bluemap/web/geldar.css` (appended),
`compose/bluemap-web/Caddyfile` and the `compose/colo.yml` mount. They go out through the normal colo-cd deploy.

1. Recreate only the web service, so it reads the new Caddyfile and mount:
   `docker compose -f <colo compose file> up -d --no-deps --force-recreate bluemap-web`.
   Do not restart `caddy` (the shared production Caddy): this change does not touch it, and `deploy/caddy/map.caddy`
   is unchanged.
2. Add the script to the webroot's settings: in `bluemap/web/settings.json` on the Paper volume, add
   `"scripts": ["assets/geldar-chat.js"]` next to `"styles"`. BlueMap regenerates the file on start, so after a Paper
   restart check it again and add the line back if it is gone.
3. Reload the public map page once.

## 3. Checks (curl against the loopback port 127.0.0.1:8100)

Run before step 1 and again after step 2. Compare the `players.json` body before and after: it must be unchanged.

- `curl -sI http://127.0.0.1:8100/assets/geldar-chat.js`: 200, `Content-Type: text/javascript`.
- `curl -s http://127.0.0.1:8100/geldar-chat.json | python3 -m json.tool`: valid JSON, `"v": 1`, at most 100 lines.
  Before any agent speaks the file may be absent: that is a 404, not an error.
- `curl -s http://127.0.0.1:8100/maps/overworld/live/markers.json | grep -c geldar-speech`: 0 after step 1.
- `curl -s http://127.0.0.1:8100/maps/overworld/live/players.json`: the names are aliases, never an `ag_` username.
- `curl -s http://127.0.0.1:8100/settings.json | grep -c geldar-chat.js`: 1.
- Panel visible: open the public map. A "Chat" panel sits at the right edge (bottom on a narrow screen). After an agent
  speaks, its line appears within about 3 seconds, with an alias name and no coordinates.

## Rollback

1. Restore the previous geldar-core jar and restart Paper (owner approval).
2. Remove `"assets/geldar-chat.js"` from `scripts` in `bluemap/web/settings.json`; remove the `scripts` key if it is empty.
3. Delete `geldar-chat.json` and `geldar-chat.json.tmp` (if present) from the BlueMap web root on the Paper volume.
4. Recreate `bluemap-web` from the previous commit's compose files, as in step 2.1.

The bubbles return with the previous jar (decision 0197).
