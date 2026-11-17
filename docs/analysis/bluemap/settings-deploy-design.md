# BM-16c: deploying the pinned settings.json without compose

Status: decided 2026-11-17. Runbook: `docs/runbooks/map-chat-panel.md` (sections 2 and 2a).

## Why compose against the node is unsafe

BM-16 (PR #665) added a read-only mount of `plugins/bluemap/web/geldar-settings.json` at
`/etc/caddy/geldar-settings.json`. The node deploy of that change failed. The node's `colo.yml` has drifted from
`main`, so `docker compose -f compose/colo.yml` against it is not the same stack that main describes:

- literal project and network names differ from the names compose derives on main;
- the Paper cap differs from main's;
- the published ports are literal values, not the `${GELDAR_PORT_*}` interpolation main uses;
- a gamerule the node sets is missing from the node's file;
- compose wants to recreate the shared `colo` network, and it cannot, because the network still has active endpoints
  (failure on 2026-11-17: "active endpoints").

Recreating `bluemap-web` through compose would therefore also touch the network and the other services on it. Until
the drift is reconciled in the repo, no compose command runs against the node's `colo.yml`.

## Options considered

- **A1, inline the JSON in the Caddyfile (`respond`).** No new file. Rejected: Caddy placeholders and braces in JSON
  need escaping, and the JSON would be written twice (repo file and Caddyfile), so the two could drift.
- **A2, hand-copy the pinned file into the webroot and read it from `/srv` (chosen).** No new mount. The webroot
  is already mounted read-only at `/srv` in `bluemap-web`. BlueMap does not delete extra files there: the old
  `settings.json.bak-*` files and the hand-copied files survived many restarts on the node. The Caddyfile reads
  `/srv/geldar-settings.json` and falls back to BlueMap's own `settings.json` if the copy is missing. If BlueMap ever
  deletes the copy, the handler serves BlueMap's own file (scripts and styles lost): re-copy it; the runbook section 3
  re-check catches this. The node changes are a Caddyfile write and `docker restart bluemap-web`; no compose.
- **B, `docker run` recreation of `bluemap-web` by hand.** Rejected: every alias, mount, healthcheck, port and
  network must be reproduced exactly, and one mistake changes the public map.
- **C, reconcile the node's `colo.yml` with `main`.** This is the right end state, but it is a larger packet and it
  needs an owner decision on the node's values. It stays open; A2 does not depend on it.

## Node procedure (A2)

Run on the node, as the Docker user, in this order. Paths are the node's own; nothing here runs compose.

1. Hand-copy `plugins/bluemap/web/geldar-settings.json` into the webroot as `geldar-settings.json`, as root (sudo),
   because the webroot is on the Paper volume. Check the sha256
   `a3750e6eda6e4a52289c2d8fdd6cd21315b049d89641e0da033e44eea2161f69` and the size, 542 bytes. Give it the owner and
   mode of the webroot's `settings.json`.
2. Back up the Caddyfile the container runs, not a repo copy:
   `docker exec bluemap-web cat /etc/caddy/Caddyfile > compose/bluemap-web/Caddyfile.bak-<date>`. Record the node
   file's inode with `stat -c %i compose/bluemap-web/Caddyfile`.
3. Stage main's Caddyfile at `/tmp/Caddyfile.new` (outside the bind-mount source directory), from the checkout or the
   config bundle. Compare it with the backup: `diff compose/bluemap-web/Caddyfile.bak-<date> /tmp/Caddyfile.new`.
   The only difference expected is the `/settings.json` handler hunk. Stop and report on any other difference: the
   node's Caddyfile may have node-only edits that an overwrite would clobber.
4. Validate the new Caddyfile in a throwaway container of the image the running container uses
   (`$(docker inspect bluemap-web --format '{{.Config.Image}}')`), with nothing from the node mounted except this file,
   read only, on the default network:
   `docker run --rm -v /tmp/Caddyfile.new:/etc/caddy/Caddyfile:ro $(docker inspect bluemap-web --format '{{.Config.Image}}') caddy validate --config /etc/caddy/Caddyfile`.
   The pinned file is not mounted: the Caddyfile reads it from `/srv`, and validate does not read the webroot.
5. Write the new Caddyfile in place: `cat /tmp/Caddyfile.new > compose/bluemap-web/Caddyfile`. Never `mv`, never `cp`
   over it through a rename, never `sed -i`: the bind-mounted inode must stay. Check that `stat -c %i` is the same
   as in step 2, and that `docker exec bluemap-web sha256sum /etc/caddy/Caddyfile` equals `sha256sum /tmp/Caddyfile.new`.
   Then remove `/tmp/Caddyfile.new`.
6. `docker restart bluemap-web`. Same container, same networks, aliases, mounts and ports. `caddy reload` is not
   possible because the Caddyfile has `admin off`. Expect a few seconds of downtime on the public map.
7. Verify: the container is Up and `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8100/settings.json` returns
   200 within 20 seconds (bluemap-web has no healthcheck). Then `GET /settings.json` equals the pinned file (`cmp`),
   `Content-Type: application/json`, `Cache-Control: no-cache`; `POST /settings.json` gives 405; the chat, sky and css
   assets and `geldar-chat.json` give 200.

**Rollback:** write the saved Caddyfile back in place the same way (step 5), `docker restart bluemap-web`, and
re-verify those URLs. The webroot copy may stay; nothing references it then. Use the same rollback if the container is
not Up, or the `settings.json` check does not return 200, within 20 seconds.

## What stays true

- The three single-file bind mounts (`geldar-chat.js`, `geldar-sky.js`, `geldar.css`) are already on the node. To change
  one, overwrite it in place and restart the container.
- The config bundle still ships `geldar-settings.json`: it is the source for the hand copy.
- Repo tests fix the Caddy semantics (`tools/repo-checks/src/bluemap-web.test.ts`, real caddy image): pinned copy
  present, pinned copy missing (the fallback), POST 405, and an empty webroot (404).
