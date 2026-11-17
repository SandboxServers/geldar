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
- Run 7: passed. Our own mod loaded on a dedicated server, and the vanilla probe still passed with it installed. See section 8.

## 5. Findings worth keeping

- The `itzg/mc-proxy` image runs as root when the UID setting is non-zero. We checked this from its start script. Live behaves the same.
- The PCF config file is mode 600, and its owner uid varies between runs. Cause not verified.
- One netty IndexOutOfBounds at `PCF VarInt.read` appeared at start-up, from a one-byte connection. It looks benign. We did not verify the sender.
- A Mojang profile lookup warning appears at whitelist add. It is harmless.
- Scratch `down` removes the probe image too.
- Tick and TPS commands that worked on the NeoForge server console (run through `rcon-cli` in the service named `paper`): `tick query` and `neoforge tps`.

## 6. Not proven

- Human vanilla client (criterion 4).
- Our own mod beyond one load (run 7, section 8): a second start with the jar, any behaviour of the mod, and events exported.
- Registry key absence, read independently.
- Behaviour with many Bodies.
- UUID forwarding in online-mode.
- Windows and other platforms.

## 7. Recommendation

- The golem stays the Body for the second shard. This is option A in p0-body-model.md. Goldar's in-server bodies are not needed.
- Next packets, in order:
  1. Operator-side registry check.
  2. Mod jar mount for the scratch stack (done in run 7; see section 8).
  3. NeoForge adapter design.
- The human client route stays a separate approval.

## 8. Run 7: our own mod

- 2026-11-17, main 423b6ceb, scratch NeoForge 26.1.2 (build 126), Java 25, suffix nf, dedicated server.
- `/data/mods`: `geldar-neoforge.jar` (2,439 bytes, mode 644) and `proxy-compatible-forge.jar`. Built on the desktop from a clean export at 423b6ceb; two builds gave the same sha256; host and container hash checks passed.
- Mod load: the paper log has `geldar_neoforge loaded on the dedicated server` once. The mod-list lines are
  `Geldar NeoForge 0.1.0 (geldar_neoforge)` and ` - geldar_neoforge (jar(mods/geldar-neoforge.jar))`.
- Vanilla Body probe, with the mod installed: join ok, goto completed, mine completed, cleanup registry=removed
  whitelist=removed. The whitelist was empty afterwards. Name and UUID agree across the logs (values not recorded here).
- Stack: `up` returned 0, all five services healthy, seed one-shot exited 0. Tick 20/s. `neoforge tps` 20.000 in every
  dimension. Every service under 0.3% CPU. Paper 1.48 GiB of a 3 GiB cap (one run).
- Users: Paper and eventsink uid 1001. Velocity uid 0 (recorded, as in run 4). PCF config mode 600, owner 1001:1000.
- The offline bundle was rebuilt for this run (144,507,078 bytes, 78 files). The old tarball predated a change to the
  build script. Bundle size and hash differ between builds, so none is pinned in the runbook.
- Start-up noise, not from our code, logged before the mod line: the kqueue DebugFile ERROR (also runs 3 to 5) and the
  one-off netty VarInt IndexOutOfBoundsException (also runs 4 to 6). Both are in the runbook's known noise list.

- Proves: the skeleton loads on a dedicated server, logs its start line and adds no payloads; the vanilla Body still joins, moves, mines and cleans up with the mod installed.
- Does not prove: that the mod does anything (no behaviour yet, no events exported); a second start with the jar; a human vanilla client (criterion 4 is still NOT RUN); many Bodies; the registry key read from outside; a second probe or a Paper restart (no safe runbook step exists for either).
