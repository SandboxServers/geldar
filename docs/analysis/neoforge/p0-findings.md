# P0 findings: NeoForge scratch join test

Date: 2026-11-17. Status: one run per result; scratch stack only.

This records the P0 join test of a vanilla-protocol golem Body against a scratch NeoForge server behind Velocity. The test criteria are in [p0-body-model.md](p0-body-model.md), section 8. Run history and open questions are in [RESUME.md](RESUME.md).

## 1. Setup

- Server: scratch NeoForge 26.1.2 (build 126), Java 25.
- Proxy: Velocity with Proxy Compatible Forge 1.3.1 forwarding.
- Body: the vanilla-protocol golem Body, used as a probe.
- Code: main at 970de743.
- Node: Colo scratch project, suffix nf.
- We added no payloads and no registry entries to the server. The Body joined with no registered payloads.

## 2. Result against P0 pass criteria

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Body joins through Velocity and appears in the player list | PASS | Velocity admitted the connection. The server logged the login and "joined the game". |
| 2 | One `goto` and one `mine` action complete | PASS | `goto` completed in 395 ms. `mine` completed in 39.5 s: one sample, a stone block. The `mine` figure is a single sample and must not be compared with the bench figures in p0-body-model.md, section 6. |
| 3 | UUID and name match across the stack | PASS, with a limit | The UUID and name were the same on the Body, on Velocity and on the server. The server's UUID equals the standard offline-mode UUID (UUIDv3 of md5 of "OfflinePlayer:" plus the name). We recomputed it independently and it matched. We did not compare it with a Paper run for the same id. The match is by derivation only. |
| 4 | Human vanilla client joins the same port | NOT RUN | Needs the human connection route, which has a separate approval. |
| 5 | Tick time and memory recorded against the cap | PARTIAL | See section 2.1. Measured at idle plus about 45 s of one Body, not under load. |

### 2.1 Criterion 5 figures

- Server tick: `tick query` reports 20 ticks per second at 0.1 ms. `neoforge tps` reports an overall 20.000 TPS at 0.104 ms per tick.
- Game server container (the compose service named `paper`, which runs NeoForge on this stack): 1.636 GiB of a 3 GiB cap, at 0.19 to 0.52 percent CPU.
- Velocity: 189 MiB of a 768 MiB limit.
- Another scratch run was on the same node during the measurement.
- The 1.5 CPU cap was not tested under load.

## 3. Cleanup

- Whitelist was empty afterwards.
- Registry removal relied on the probe's own "registry=removed" line. We did not read the registry independently.
- `down` removed all scratch volumes, networks and images.
- Live container names were identical to the baseline taken before the run.

## 4. Run history

- Run 1: failed on the NATS healthcheck. Cause: it probed the monitor port. Fixed by probing the client port.
- Run 2: failed on missing identity KV buckets. Cause: the seed service.
- Run 3: came up healthy.
- Run 4: stopped at the Velocity uid check. The Velocity java process runs as uid 0.
- Run 5: stopped at the mod-load check. The runbook and the stack did not match: the scratch stack mounts no geldar jar.
- Run 6: passed. This is the run in section 2.

## 5. Findings worth keeping

- The `itzg/mc-proxy` image runs as root when the UID setting is non-zero. We checked this from its start script. Live behaves the same.
- The PCF config file is mode 600, and its owner uid varies between runs. Cause not verified.
- One netty IndexOutOfBounds at `PCF VarInt.read` appeared at start-up, from a one-byte connection. It looks benign. We did not verify the sender.
- A Mojang profile lookup warning appears at whitelist add. It is harmless.
- Scratch `down` removes the probe image too.
- Tick and TPS commands that worked on the NeoForge server console (run through `rcon-cli` in the service named `paper`): `tick query` and `neoforge tps`.

## 6. Not proven

- Human vanilla client (criterion 4).
- Our own mod loading. The geldar mod jar was not mounted in scratch.
- Registry key absence, read independently.
- Behaviour with many Bodies.
- UUID forwarding in online-mode.
- Windows and other platforms.

## 7. Recommendation

- The golem stays the Body for the second shard. This is option A in p0-body-model.md. Goldar's in-server bodies are not needed.
- Next packets, in order:
  1. Operator-side registry check.
  2. Mod jar mount for the scratch stack.
  3. NeoForge adapter design.
- The human client route stays a separate approval.
