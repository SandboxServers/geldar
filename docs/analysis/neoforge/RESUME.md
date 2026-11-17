# NeoForge campaign (session geldar-neoforge) RESUME

State 2026-11-17. Read this, then [p0-body-model.md](p0-body-model.md).

## State
- Freeze lifted for own docs/analysis and own-area PRs. No node, VM or world changes by this session; node steps run by the main orchestrator or ops after the owner's explicit go.
- P0 node run is in progress on the Colo scratch stack, suffix nf, run by ops under geldar-93 (owner approved). It stops at the first failure. The raw report goes to geldar-93; findings are written up here afterwards.
- No decision numbers until the main orchestrator assigns a block.

## PRs
- Merged: #593 (P0 Body-model note), #594 (API notes and progression design), #596 (P2 plugin/core split), #600 (scratch NeoForge overlay, suffix nf), #601 (neoforge/ skeleton: NeoForge 26.1.2 (build 126), Java 25, lock and verification, no CI lane), #604 (earlier RESUME), #607 (installer fetch retry), #610 (scratch uid fix: SCRATCH_RUN_UID/GID), #611 (offline bundle), #614 (declared source-scan inputs for plugin/core tests), #619 (message-only fix for the verifyTestSourceInputs failure text), #620 (RESUME), #622 (NATS healthcheck), #632 (identity buckets seed), #633 (NATS users docs), #634 (telemetry test timeout), #643 (runbook run 3 notes), #645 (P0 probe).
- The telemetry and CI lane is owned by geldar-telemetry, not this campaign. The NeoForge CI lane exists: job `neoforge` in ci.yml, feeds ci gate, lenient lock mode; first green run 2026-11-17 (e7d84df9).

## Packets
- P0 join test: golem Body joins the scratch NeoForge server through Velocity. Ops runs `SCRATCH_PLATFORM=neoforge ... scratch.sh up nf`, then the probe (docs/runbooks/scratch-stack.md, NeoForge section and P0 probe).
- P0 run results so far:
  - Run 1 stopped at the NATS healthcheck.
  - Run 2 stopped at the identity buckets.
  - Run 3 came up healthy.
  - Run 4 stopped at the Velocity uid check. The Velocity java process is uid 0. The `itzg/mc-proxy` image drops privilege only when `$UID` is 0, so our `UID=1001` leaves it root; live colo does the same. Velocity is now recorded, not blocking, in the runbook.
  - Run 5 (2026-11-17) stopped at first-run check 1 (mod load): the scratch stack mounts no geldar jar. The runbook now marks check 1 N/A until a mod jar is mounted; the probe has not run yet.
- P0 verified (runs 1-4):
  - Proxy Compatible Forge 1.3.1 loads on NeoForge 26.1.2.
  - Server ticks at 20 TPS.
  - Paper JVM runs as uid 1001 (the account).
  - The eventsink `/app` is readable.
  - The PCF forwarding config is mode 600.
- P0 unverified:
  - Vanilla join, and the UUID and name the server sees on 26.1.
  - The probe's goto, mine and cleanup.
  - The netty `VarInt` line in the Paper log at 13:51:04 (no client; likely Paper's own healthcheck ping; UNVERIFIED). The runbook has a one-minute watch for it.
  - PCF config owner: uid 1000 on a mode 600 file, against the Paper JVM's 1001 (observed; cause unverified).
- Next: run 5 with the probe, once the owner or main orchestrator schedules it.
- On hold: P0b (scratch golem-body and geldar-mcp for the Claude-mind test; the Mind-host route is not decided). P3 (NeoForge adapter event export and maintenance notices). P4 (own block-owner log and gravestones). P5 (BlueMap and pregeneration). P6 to P8 (progression): ON HOLD for the owner's six policy decisions in progression-design.md. Human connection route (tunnel or proxy): needs separate approval. CI lane for neoforge/: needs a separate owner-approved PR.
- Pins: NeoForge 26.1.2 (build 126); Proxy Compatible Forge 1.3.1.

## Lessons
- The repo IP-literal check rejects dotted four-number build strings; write "26.1.2 (build 126)".
- Reviewers caught a loaderVersion bug and an invalid sha512sum flag before any node run.
- The scratch phase0 stack has no golem-body or geldar-mcp (colo.yml only).
- The mc-proxy image runs as root with our UID setting, on live too. Compose comments that say the itzg image "drops to this uid" are true for Paper, not for the proxy.

## Open questions
- Does a vanilla-protocol golem Body join a NeoForge 26.1.2 server behind Velocity with no registered payloads? Which UUID and name does it see? (P0)
- Confirm NeoForge 26.1 non-NeoForge handshake rules; the mirrors cover 1.20.4 to 1.21.5 only.
- Mind-host route, MCP listen address, port and dev token file for the scriptorium seam; owner approval for the human connection route (tunnel or proxy). (P0b, P0)
- Owner: whether the mc-proxy root setting is changed on live (a deploy change), and whether the PCF config owner must match the server user.

## Next actions
1. Run 5 of P0 with the probe, under geldar-93 and the owner's go. The raw report goes to geldar-93, then findings are written up here and in p0-body-model.md.
2. Main orchestrator schedules the merge of this runbook and RESUME update after review.
3. P0b is written once the Mind-host-to-node route is decided.

Result: P0 probe run results (2026-11-17) are in [p0-findings.md](p0-findings.md).

Mind route options (how to connect a Claude Mind to the NeoForge shard, desktop rehearsal first, final instance later): [mind-route.md](mind-route.md).
