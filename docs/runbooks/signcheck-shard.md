---
title: "Signcheck shard"
type: how-to
audience: contributors
status: draft
last_verified: 2026-11-16 against 03c1f5de
companions: [README.md, map-chat-panel.md]
sources: [../../compose/signcheck.yml, ../decisions/0192-edit-sign-action.md, golem/src/actions/edit-sign.test.ts, contract/test/edit-sign-action.test.ts]
---

# Signcheck shard

A throwaway vanilla Paper server for checking sign facts. It exists to check the eleven sign facts that edit_sign depends on, for an edit_sign live test. That live test, `golem/test/live/edit-sign.live.test.ts` (named here and in the header of `compose/signcheck.yml`), is on the branch `phase1/body-edit-sign-live` (added in commit `37172f47`) and is not merged to `main`: `git merge-base --is-ancestor 37172f47 03c1f5de` fails, and `git ls-files golem/test/live` at `03c1f5de` does not list it (2026-11-16). On `main`, the edit_sign tests are unit tests: `golem/src/actions/edit-sign.test.ts` and `contract/test/edit-sign-action.test.ts`. It is not part of Phase 0 or Colo.

## What it is

- `compose/signcheck.yml`: by default one service, `paper`, from the same pinned Paper image as phase0. No Velocity, NATS, plugins or secrets. Survival mode.
- Profile `core`: adds `nats` (internal only, no host ports) and `paper-core` (the same Paper with geldar-core loaded). Used for the bubble and proximity probes below.
- Profile `rcon`: adds `paper-rcon` (the same Paper with RCON on, for the edit-sign live check fixture only). See the RCON section below.
- Compose project `geldar-signcheck`, run on its own VM, separate from the phase0 shard and from Colo.
- World volume `geldar-signcheck_paper-data` (override with `GELDAR_WORLD_VOLUME`).

## Start

```powershell
docker compose -p geldar-signcheck -f compose/signcheck.yml up -d
```

Wait until `docker compose -p geldar-signcheck ps` shows the service healthy. The first boot takes several minutes.

## Endpoint

Minecraft on host port **25570** (container 25565). The server is in offline mode, with no whitelist. The default profile has no RCON; the `rcon` profile turns it on (see below). The port is bound to `127.0.0.1` only, so clients must run on the VM itself (or tunnel to it).

## Core profile (geldar-core probes)

The `core` profile runs the same Paper with geldar-core loaded, plus a private NATS for its life registry and bus. `paper` and `paper-core` share the `paper-data` world volume, so run only one of them at a time. Stop `paper` before you start `paper-core`.

1. Build the jar from main, in the repo root:

   ```powershell
   (cd plugin; ./gradlew build)
   Copy-Item plugin/core/build/libs/geldar-core.jar compose/plugins/geldar-core.jar
   ```

   `compose/plugins/` is not gitignored. Never `git add` the jar. Set `GELDAR_CORE_JAR` to use a jar from elsewhere.

2. Create the RCON password file by hand, outside git: `compose/secrets/signcheck-rcon.txt` (gitignored; or `GELDAR_RCON_FILE`). Use a random value. Do not commit it or paste it into a log.

3. Start NATS and paper-core:

   ```powershell
   docker compose -p geldar-signcheck -f compose/signcheck.yml --profile core up -d nats paper-core
   ```

   Wait until `paper-core` is healthy. Its host port is **25571** (`127.0.0.1` only). NATS publishes no host port.

### Probes

Log each event with its timestamp from the server log, and keep the log lines with the result.

1. **Chat panel latency.** Make a bot speak. Watch the chat panel on the public map (decision 0310) and record the time the line appears there. The plugin writes the feed within 1 second of the line and the panel polls every 3 seconds, so the line should show within about 4 seconds (worst case).
2. **Proximity chat.** Place two bots in line at 20, 31, 33 and 40 blocks apart. Repeat with a wall between them at each distance. For each case, record which bot receives the chat line and which bot receives the death message.
3. **Sealed-room listener.** Put one bot in a room with no openings and one speaker outside. Record whether the listener still receives the chat. There is no occlusion today, so the listener is expected to still receive it. A change here means the occlusion behaviour has changed.

### Teardown

```powershell
docker compose -p geldar-signcheck -f compose/signcheck.yml --profile core down -v
```

`down -v` deletes the world volume and the NATS data. Nothing on this shard is kept.

## RCON profile (edit-sign live check)

The `rcon` profile runs `paper-rcon`: the same vanilla Paper as `paper`, with RCON on (container port 25575). The edit_sign live test (on the branch `phase1/body-edit-sign-live`, not on `main`; see the top of this runbook) uses RCON "to place signs, give items and move the bots on the local world" (its header comment at `37172f47`). That header also says to run it against "the shard up with `--rcon-host`" through `./geldar.ps1 pnpm --filter @geldar/golem test:live -- edit-sign`, which is the local Phase 0 shard, not this one. Which shard the test is meant for is therefore unsettled: the `compose/signcheck.yml` header and this runbook say the signcheck shard, the test's own header says the local shard. Recorded, not resolved. RCON is for that fixture only. The bots are **GolemSign** and **GolemSignB**.

`paper`, `paper-core` and `paper-rcon` share the `paper-data` world volume, and `paper-rcon` uses host port 25570 too. Run only one of them at a time. Stop `paper` before you start `paper-rcon`.

1. Create the RCON password file by hand, outside git: `compose/secrets/signcheck-rcon.txt` (gitignored; or `GELDAR_RCON_FILE`). Use `umask 077` so only the operator can read it, and a random value:

   ```sh
   (umask 077; openssl rand -base64 24 | tr -d '\n' > compose/secrets/signcheck-rcon.txt)
   ```

   Never commit the file, and never print it or paste it into a log or chat.

2. Start paper-rcon:

   ```sh
   docker compose -p geldar-signcheck -f compose/signcheck.yml --profile rcon up -d paper-rcon
   ```

   Wait until `paper-rcon` is healthy.

3. Tunnel both ports from your workstation. Each is bound to `127.0.0.1` on the VM only, so forward each with its own `-L`:

   ```sh
   ssh -L 25570:127.0.0.1:25570 -L 25575:127.0.0.1:25575 <operator>@<shard-vm>
   ```

   Port 25570 is the game port (the bots connect there); port 25575 is RCON (the fixture connects there). Hosts stay `127.0.0.1`.

### RCON teardown

```sh
docker compose -p geldar-signcheck -f compose/signcheck.yml --profile rcon down -v
```

Pass `--profile rcon` so compose also removes the `paper-rcon` container. `down -v` deletes the world volume. The password file stays on the VM; delete it with the shard if you no longer need it.

## Teardown

```powershell
docker compose -p geldar-signcheck -f compose/signcheck.yml down -v
```

`down -v` deletes the world volume. The shard is disposable: nothing on it is kept.

## Rules

- Never set `GELDAR_WORLD_VOLUME` to the Colo or phase0 world volume. Never point this shard at either.
- The flag `body_actions.edit_sign` stays **off** on Colo.
- The default profile has no secrets. The `core` and `rcon` profiles read one RCON password file from `compose/secrets/` (gitignored). Create it by hand and never commit it.
