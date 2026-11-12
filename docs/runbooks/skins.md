# Agent skins (rangers)

Skins come from MineSkin signed textures stored in the `geldar-skins` NATS KV bucket (key: life id, such as `ag_jason_01`). The Velocity identity plugin sets the `textures` property at login (decision 0140). The signed data and the PNGs are never in the repo.

## Put the skins on the node

1. Keep `ranger-skins.json` (owner file, mode 0600) outside the repo. Format: `{"ag-jason-01": {"mineskin_uuid", "value", "signature", "model"}, ...}`.
2. Copy it to the node, for example `/etc/geldar/ranger-skins.json` (owner root, mode 0600). Do not put it under `compose/` or the repo checkout.
3. With `GELDAR_NATS_URL` set to the node NATS, import each ranger (no upload runs, no MineSkin key is needed):
   `pnpm --filter ./tools/players-cli exec tsx src/cli.ts skin import ag-jason-01 /etc/geldar/ranger-skins.json` (repeat for ag-zack-01, ag-billy-01, ag-trini-01, ag-kimberly-01, ag-tommy-01).
4. The plugin watches the bucket, so a new login gets the skin; an already connected agent shows it after it reconnects (restart that body: `colo-admin.sh player-stop` then `player-start`).

## Check

Join as the agent (or look at the tab list); the skin shows for viewers. A texture host other than `textures.minecraft.net` is refused by `skin import`.

## BlueMap

`plugins/bluemap/config/plugin.conf` keeps `skin-download: false` (no fetch from Mojang for unknown UUIDs). Showing the skin on the live markers needs a live check on the node; see the SKINS report.
## Kino skins

Copy the six PNGs from your private skin files to the node directory `/var/lib/geldar-colo/kino-skins` (or set `GELDAR_KINO_SKINS_DIR`), named by Kino agent id: `<agent_id>.png` (for example `ag_jason_01.png`: Kino agent ids are the underscore life ids shown in `/kino/targets`, not the hyphen player ids; lower case letters, digits, `_` and `-` are accepted, so the file name must match the id exactly). Mode 0644 files in a 0755 directory owned by root; Glass mounts it read-only. Create the directory before `up` (the overlay does not create it). Restart `glass` after adding files. Glass serves `/kino/skins/<agent_id>.png` only to a viewer who may watch that agent.

Kino fetches the skin lazily when an agent first appears and draws a Minecraft player model (head, body, arms, legs, and the overlay layer on 64x64 skins; 64x32 legacy skins mirror the left limbs). A 404, a bad image or a size other than 64x64 or 64x32 silently keeps the cyan box; the result is cached until the page reloads, so reload after adding a skin. Slim (3 px) arms are detected from the image: a 64x64 skin whose pixels x 54..55, y 20..31 are all fully transparent is slim, otherwise classic.
