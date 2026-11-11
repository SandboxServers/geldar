# FX-IMAGES: C1 boundary review fixes for the colo images and BlueMap

Branch `fix/c1-image-hygiene`, from `origin/main`. Three findings from the C1 boundary review.

## 1. Env files reached the images (fixed)

`golem/Dockerfile.dockerignore` and `animus/Dockerfile.mind.dockerignore` excluded `.env*` only at the
build-context root. The `!golem` and `!animus` re-includes then copied `golem/.env.local` and
`animus/.env.production` into the images.

- Fix: `**/.env*` and `**/*.fakes.ts` in both ignore files. The fakes are test doubles, imported only
  by tests and fixtures (checked by grep), so the images do not need them.
- Revert evidence: a real build with the old ignore file (copied to the scratchpad, so no tracked file
  changed) and a planted `golem/.env.local` put `/opt/geldar/golem/.env.local` in the Body image. The
  same with `animus/.env.production` put it in the Mind image. With the new ignore files, `find / -name
  ".env*"` lists nothing in either image.
- Tests: `golem/src/image.test.ts` and `animus/src/image.test.ts` assert `**/.env*` and `**/*.fakes.ts`
  in the ignore files. Without the fix those assertions fail (checked).

## 2. Install scripts, healthcheck (partly done)

- `--ignore-scripts` is on both `pnpm install` lines. The production tree has no `preinstall`,
  `install` or `postinstall` script. The only lifecycle hooks are `prepare` scripts, which pnpm does
  not run for registry tarballs. Both images build, the smoke `docker run --rm <image>` fails with the
  same missing-shard fatal line as before (`/opt/geldar/shards/phase0.yaml`), and every direct
  dependency imports inside the image. The image tests assert the flag (checked: they fail without it).
- No HEALTHCHECK. A `node` one-liner that exits 0 when the process is up is not an honest check. The
  honest check needs a status endpoint. Recorded as: no healthcheck, needs a status endpoint, future.
- `init: true` is not added here: compose is owned by another packet.

## 3. BlueMap config keys and render threads (fixed)

The pinned jar `bluemap-5.29-paper.jar` was downloaded to a scratchpad directory, its SHA-256 checked
against `bluemap.lock.json` before any use, and only the seven default `.conf` files were extracted.
The jar was not run. Both the jar and the extracted files were deleted afterwards.

Key-name comparison against the 5.29 defaults (`core.conf`, `plugin.conf`, `webserver.conf`,
`maps/map.conf`):

- Every committed key exists in 5.29 under the name the config uses. No misnamed key was found.
- Needed keys absent from the committed config (`update-cooldown`, `scan-for-mod-resources`, `log`,
  `sse-enabled`, `additional-headers`, `hide-below-sky-light`, `hide-below-block-light`,
  `hide-different-world`, `render-mask`, `min-y`, `max-y`, `subtract`): all have defaults that the
  config does not need to override. None is a safety setting left open.
- `ip` (bind address): not a key in 5.29's `webserver.conf`. The defaults have `enabled`, `webroot`,
  `port`, `sse-enabled`, `additional-headers` and `log`. The README claim "BlueMap 5.29 has no
  bind-address option" is correct for 5.29. The earlier recollection that `ip` exists was wrong for
  this version. The webserver stays disabled.
- `render-thread-count`: the default is 1. The committed `0` means one thread per CPU core, which
  competes with the game tick, so it is now `1`, explicit.

`plugins/bluemap/known-keys.json` records the version, the jar SHA-256 and the top-level defaults of
the four files. `plugins/bluemap/test/config.test.ts` fails on any committed key that is not in it
(revert check: `hide-sneaking` misspelled as `hide-sneeking` fails the test). The test also now
requires the webserver to be off; the old branch accepted an `ip` key that 5.29 does not have.

## Not done

- `docs/analysis/phase1/worknotes/P1-C1-09.md` still says the bind-address claim as the earlier
  worknote wrote it. It is outside this packet, so it is unchanged.
- No image was run against the stack. Only the image build and the standalone smoke ran.
