# Agent skins (rangers)

Skins come from MineSkin signed textures stored in the `geldar-skins` NATS KV bucket (key: life id, such as `ag_jason_01`). The Velocity identity plugin sets the `textures` property at login (decision 0140). The signed data and the PNGs are never in the repo.

## Put the skins on the node

The signed JSON (`ranger-skins.json`, format `{"ag-jason-01": {"mineskin_uuid", "value", "signature", "model"}, ...}`) is an owner secret. It never goes in the repo, in `compose/`, in a chat or in a command line.

On the Colo node (no node or pnpm on the host; the admin image carries `players-cli`):

1. Make a skins directory outside the checkout, mode 0700, owned by the service uid, for example `install -d -m 700 -o 1000 -g 1000 /etc/geldar/skins-in`. Copy the file in as `/etc/geldar/skins-in/ranger-skins.json`, mode 0600, owner the service uid (the container runs as that uid and reads it through a read-only mount).
2. For each ranger (ag-jason-01, ag-zack-01, ag-billy-01, ag-trini-01, ag-kimberly-01, ag-tommy-01):
   `GELDAR_SKINS_DIR=/etc/geldar/skins-in deploy/colo-admin.sh skin-import ag-jason-01 --file /run/skins/ranger-skins.json`
   The script mounts the directory read-only at `/run/skins` in a one-shot admin container, which connects to NATS as the `body` user (password file `nats-body.txt`, already mounted in the admin service) and writes the bucket key (the life id from `shards/colo-mind.yaml`). It prints the player id and life id only, never the value, and exits non-zero with a message on failure. `DEPLOY_DRY_RUN=1` prints the plan.
3. The plugin watches the bucket, so a new login gets the skin; an already connected agent shows it after it reconnects (restart that body: `colo-admin.sh player-stop` then `player-start`).
4. Delete the file from the node when done, or keep it mode 0600 in that 0700 directory.

Needs: an admin image built from this change (it adds `tools/players-cli`), and a NATS auth config whose `body` user may publish `$KV.geldar-skins.>` (regenerate `nats-auth.conf` with `./geldar.ps1 shard nats-auth colo` and recreate the NATS container; this is a separate owner approval step, and the passwords stay unchanged). `ensure-skins-bucket` must have run once (colo-up does it).

On a dev machine with the Phase 0 shard, the original path still works: `pnpm --filter ./tools/players-cli exec tsx src/cli.ts skin import ag-jason-01 <json outside the repo>` with `GELDAR_NATS_URL` and the NATS user set.

## Check

Join as the agent (or look at the tab list); the skin shows for viewers. A texture host other than `textures.minecraft.net` is refused by `skin import`.

## Verify a skin was applied

The plugin keeps the `geldar-skins` bucket in memory through a live watch, so a key written while Velocity runs is used by the next login (no restart). Every login of a registered life writes one `skin:` line, with no texture value or signature:

```
docker logs geldar-colo-velocity-1 | grep skin:
```

- `skin: bucket geldar-skins synced, N keys cached, M rejected` once per sync (start, NATS reconnect). N is the number of valid skins.
- `skin: applied for <life_id> (variant classic|slim)`: the textures property was set on the profile.
- `skin: no record for <life_id>`: the bucket is synced but has no key for that life id (check the key with `players-cli skin show`).
- `skin: record for <life_id> rejected: <reason>`: the record exists but fails validation (life_id does not match the key, texture not on `textures.minecraft.net`, signature not base64, value or signature missing or too long, not JSON).
- `skin: KV unavailable: <error class>`: the bucket is not synced (NATS down, or the bucket absent), so no skin is set. The watcher logs why (`Bucket geldar-skins is absent` or `unavailable`).
- `skin: lookup skipped (not a sovereign life)`: the name is not in the life registry; the login gets the default profile.

Read-only check of what is stored (prints the variant, texture host and signature length, never the value or the signature; needs `GELDAR_NATS_URL`):

```
pnpm --filter ./tools/players-cli exec tsx src/cli.ts skin show ag-jason-01
```

(`colo-admin.sh` has no `skin-show` verb yet; run it from a checkout with `GELDAR_NATS_URL` and the NATS user set.) If the plugin says `applied` but the head is still Steve, the proxy did its part: the client or the map is not using the forwarded textures (see BlueMap below).

## BlueMap

`plugins/bluemap/config/plugin.conf` keeps `skin-download: false` (no fetch from Mojang for unknown UUIDs). Showing the skin on the live markers needs a live check on the node; see the SKINS report.
## Kino skins

Copy the six PNGs from your private skin files to `compose/secrets/kino-skins/` in the source tree on the node (the overlay `compose/colo-kino.yml` mounts `./secrets/kino-skins` relative to `compose/`; git-ignored), named by Kino agent id: `<agent_id>.png` (for example `ag_jason_01.png`: Kino agent ids are the underscore life ids shown in `/kino/targets`, not the hyphen player ids; lower case letters, digits, `_` and `-` are accepted, so the file name must match the id exactly). The files must be readable by the Glass uid (mode 0644 in a 0755 directory is enough); Glass mounts it read-only. Create the directory before `up` (the overlay does not create it). Restart `glass` after adding files. Glass serves `/kino/skins/<agent_id>.png` only to a viewer who may watch that agent.

Kino fetches the skin lazily when an agent first appears and draws a Minecraft player model (head, body, arms, legs, and the overlay layer on 64x64 skins; 64x32 legacy skins mirror the left limbs). A 404, a bad image or a size other than 64x64 or 64x32 silently keeps the cyan box; the result is cached until the page reloads, so reload after adding a skin. Slim (3 px) arms are detected from the image: a 64x64 skin whose pixels x 54..55, y 20..31 are all fully transparent is slim, otherwise classic.


## Show the skin on the BlueMap markers

BlueMap 5.29 shows a player head from `maps/<mapId>/assets/playerheads/<uuid>.png` in its web root and falls back to `assets/steve.png` on a 404. BlueMap only downloads skins from Mojang by UUID, and our agents have offline UUIDs with no Mojang profile, so nothing writes those files. `skin heads` generates them from the skin PNGs Kino serves (`<agent_id>.png`, for example `ag_jason_01.png`): the 8x8 face with the hat layer composed over it, scaled 4x by nearest neighbour to 32x32 so the browser's smoothing stays crisp. The file name is the Java offline UUID of the life id (`UUID.nameUUIDFromBytes("OfflinePlayer:" + name)`; `ag_jason_01` is `a380937d-20dd-39b8-83ae-4219fa1c156d`). The command prints only `name uuid` lines.

On the desktop (a checkout), against the Kino skin files:

```
./geldar.ps1 pnpm --filter @geldar/players-cli exec tsx src/cli.ts skin heads --skins-dir <kino skins dir> --out-dir <scratch dir> --map overworld
```

Then, on the Colo as the operator, copy the output tree into Paper's data volume web root (no restart; the files persist in the `paper-data` volume; refresh the browser):

```
docker cp <scratch dir>/maps/. geldar-colo-paper-1:/data/bluemap/web/maps/
```

BlueMap serves them through bluemap-web at `maps/<map>/assets/playerheads/<uuid>.png`. Run it again when a skin changes.

Finding: the node's BlueMap config is copied from the repo's `plugins/bluemap/config/plugin.conf` at Paper start (host path `src/plugins/bluemap/config/plugin.conf`). Changing it live in the volume is reverted at the next Paper recreate unless the repo file (now `skin-download: true`, PR #177) is also deployed to `src/plugins/bluemap/config/plugin.conf` on the node.
