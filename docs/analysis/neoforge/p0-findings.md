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
- Registry removal: runs 6 and 7 relied on the probe's own "registry=removed" line. From run 8b the probe reads the key back after cleanup and prints `p0 verify registry=absent` (section 9), which is a re-read that does not trust the delete call. One run so far.
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
- Run 8: the first attempt stopped at the export step. The generator then ran in the live checkout: eight ignored files were written and nothing ran, so no harm. Run 8b is the rerun.
- Run 8b: passed. The probe read the registry key back after cleanup and got `absent`. See section 9.

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
- Registry key absence after a TTL expiry. Run 8b read a key that had been deleted, not one that expired on its own.
- Any second read of the registry key: there is one verify line (run 8b).
- A second probe run, or a second start with the jar mounted, after run 8b.
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

- 2026-11-17, dedicated server, scratch NeoForge 26.1.2 (build 126), Java 25, suffix nf, one run.
- Code: main at 423b6ceb (merge of #663, the mod mount).
- Mod load: our mod (`geldar_neoforge`) loaded on the dedicated server: the full server log has the line "geldar_neoforge loaded on the dedicated server" once, and the mod list shows "Geldar NeoForge 0.1.0". The mods directory held our jar (2,439 bytes) and the Proxy Compatible Forge jar.
- Jar: built on the desktop from a clean export at 423b6ceb; two builds gave the same sha256; the host and the container hash checks both passed.
- Vanilla Body join through Velocity, with the mod installed: passed (join, goto, mine, cleanup of the registry entry and the whitelist entry). Name and UUID agree; the UUID is the offline-mode one.
- Stack (one run): `up` returned 0 with all five services healthy; tick 20/s; `neoforge tps` 20.000 in every dimension; every service under 0.3 percent CPU; the game server container at 1.48 GiB of its 3 GiB cap; Paper-side and eventsink processes ran as the account uid, Velocity as root (see the runbook).
- Start-up noise (the kqueue DebugFile ERROR and the one-off netty VarInt IndexOutOfBounds) is in the runbook's known noise list.

- Proves: the mod loads on a dedicated server, and the vanilla Body joins through Velocity with it installed.
- Does not prove: that the mod does anything yet; a second start with the jar; a human vanilla client (criterion 4 is still NOT RUN); many Bodies; the registry key read from outside; online-mode UUID forwarding.

## 9. Run 8b: the probe verifies the registry key

- 2026-11-17, scratch NeoForge 26.1.2 (build 126), Java 25, suffix nf, one probe run. Code: main at d60f589a.
- Stack: `up` reached healthy for all five services. The offline bundle was rebuilt for this run (144,507,104 bytes; new sha256, not pinned).
- Mod: loaded once on the dedicated server. The game server ran as the account uid.
- Probe: exit 0. Join, goto and mine completed. `p0 cleanup registry=removed whitelist=removed`, then `p0 verify registry=absent` as the last stdout line. The whitelist was empty afterwards.
- Logs: the probe name appears 9 times in the game server log and 6 times in the Velocity log. The netty VarInt trace appeared twice, both in the same second and before the probe; none appeared after it.
- `down` was clean, and the live container names matched the baseline.
- Proves: in this run the delete took effect. The probe read the key back after cleanup, without trusting the delete call, and got `absent`.
- Does not prove: a read of a key that expired by TTL (this run read a deleted key); a second probe run or a restart with the jar mounted; a human vanilla client; many Bodies.
