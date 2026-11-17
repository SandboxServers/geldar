# BM-16 design: keep Geldar scripts in settings.json across restarts

Status: design, recommendation A. No code in this commit.

Status: node steps superseded by BM-16c (settings-deploy-design.md); do not run compose against the node's colo.yml.

## Problem

BlueMap (5.29) rewrites the node webroot's `settings.json` at every Paper and BlueMap start, and writes
`"scripts": []` and `"styles": []`. The chat panel (`geldar-chat.js`), the dial (`geldar-sky.js`) and the stylesheet
(`geldar.css`) then disappear from the public map until someone adds them back by hand. This happened on 2026-11-16 at
10:32Z. The live file that must be reproduced is the 5.29 output with `scripts` and `styles` filled in: the keys
`version`, `useCookies`, `defaultToFlatView`, the zoom and slider settings, `mapDataRoot`, `liveDataRoot`,
`clientDecompression`, `maps`, `scripts` and `styles`, pretty-printed with a 2-space indent.

Any fix must survive a restart without a person in the loop, and must not touch the shared Caddy service.

## Options

**A (recommended): Caddy serves `GET /settings.json` from a pinned file in the repo.**
A new file `plugins/bluemap/web/geldar-settings.json` is mounted read only into `bluemap-web` at
`/etc/caddy/geldar-settings.json`. A `handle /settings.json` block in `compose/bluemap-web/Caddyfile` rewrites to it and
sets `Content-Type: application/json` and `Cache-Control: no-cache`, the same shape as the `geldar-sky.js` handler.
The regenerated file on disk no longer matters for the public site.
- Pros: restart-proof by construction; no code path to race; no new container; no watcher; the content is reviewed in git;
  the change is one mount, one handler and one file.
- Cons: the pinned copy must be re-checked on a BlueMap upgrade and when a map is added, because BlueMap would otherwise
  list maps that the pinned file does not. Tests tie the file to `plugins/bluemap/known-keys.json` (the BlueMap
  version) and to `plugins/bluemap/config/maps/*.conf` (the map names), and tie `scripts` and `styles` to the existing
  Caddy handlers.

**B: a Caddy templates transform of the live file.**
Caddy's `templates` directive could splice the scripts into the regenerated file on each request.
- Cons: stock Caddy templates do not parse JSON into structures, so inserting into the array is string surgery on
  BlueMap's exact formatting. Fragile across BlueMap versions. Not verified against the pinned image, so not chosen.

**C: extend the `bluemap-alias` proxy to read the webroot and inject the entries.**
- Cons: new code on the path that carries player data, a new mount of the whole webroot, and more moving parts than
  the problem needs. The proxy is for live player JSON, not for settings.

**D: a BlueMap `webapp.conf` option such as `update-settings-file: false`.**
- Cannot be verified from the repo. The pinned jar is not available locally, and checking the option needs a Paper
  restart, which needs owner approval. It would also stop BlueMap adding new maps to the file, so new maps would need a
  hand step. Optional extra only after it is verified on a node.

**E: a watcher or sidecar that patches the file when it changes.**
- Cons: a new container, a race between BlueMap's write and the patch, and a second writer on a file BlueMap owns.

## Recommendation

Option A. It removes the failure at its source (the public site no longer reads BlueMap's file for these keys), it is
checked by tests on every change, and it adds no runtime code. The one recurring cost is the re-check on a BlueMap
upgrade or a new map, and the tests make that cost visible: a version or map mismatch fails the test suite.

## Node steps (ops, with the coordinator's authorisation)

1. Copy `plugins/bluemap/web/geldar-settings.json` and the updated `compose/bluemap-web/Caddyfile` to the node.
2. Add the one mount line `../plugins/bluemap/web/geldar-settings.json:/etc/caddy/geldar-settings.json:ro` to the
   `bluemap-web` volumes in the node's `compose/colo.yml`, after the sky mount.
3. Recreate `bluemap-web` alone. Never recreate the shared Caddy service.
4. Verify: `GET /settings.json` on the loopback map port returns the pinned file byte for byte; `POST` returns 405.
5. Hand step, not automated: list the webroot's `settings.json.bak-*` files (about 8), keep the newest backup, and
   delete the rest by hand.

This change does not touch `golem/`, `eventsink/`, `tools/admin/` or `glass/`. It needs no auto-deploy and no Body
restart.

## Test plan (commit 2)

- `plugins/bluemap/test/settings-pin.test.ts`: the pinned file parses and has exactly the keys above; `version` equals
  `known-keys.json` `bluemap`; `maps` equals the set of `config/maps/*.conf` names; `scripts` and `styles` match the
  Caddy handlers; the Caddy block rewrites to the pinned file with `application/json` and `no-cache`; the mount and the
  bundle line exist; the file has no secrets and no addresses.
- Revert demos: remove the Caddy settings handler and run the test (must fail); set `"scripts": []` in the pinned
  file and run it (must fail).
