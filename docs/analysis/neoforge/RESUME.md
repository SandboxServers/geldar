# NeoForge campaign (session geldar-neoforge) RESUME

State 2026-11-17. Read this, then [p0-body-model.md](p0-body-model.md).

## State
- Freeze lifted for own docs/analysis and own-area PRs. No node, VM or world changes by this session; node steps run by the main orchestrator or ops after the owner's explicit go.
- P0 node runs (through run 7, which passed) were on the Colo scratch stack, suffix nf, run by ops under geldar-93 (owner approved). A run stops at the first failure. The raw report goes to geldar-93; findings are written up here afterwards.
- No decision numbers until the main orchestrator assigns a block.
- Progression defaults (2026-11-17, owner delegation): proposed in [progression-defaults.md](progression-defaults.md). Not in force until the flagged decision record exists; P6 to P8 stay on hold until then.

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
  - Run 6: passed (the probe; see p0-findings.md section 2).
  - Run 7 (2026-11-17) passed: our own mod (geldar_neoforge) loaded on a dedicated server, and the vanilla probe still passed with it installed. Check 1 is blocking when a jar is mounted. Not exercised: a second start with the jar, a second probe, a Paper restart (no runbook step yet). See p0-findings.md section 8.
- P0 verified (runs 1-7):
  - Proxy Compatible Forge 1.3.1 loads on NeoForge 26.1.2.
  - Server ticks at 20 TPS.
  - Paper JVM runs as uid 1001 (the account).
  - The eventsink `/app` is readable.
  - The PCF forwarding config is mode 600.
  - A vanilla-protocol golem Body joins a NeoForge 26.1.2 server behind Velocity with Proxy Compatible Forge 1.3.1 (runs 6 and 7). The name and UUID agree across the stack; the UUID is the offline-mode one.
  - The probe's goto and mine complete (run 6).
  - Our own mod (geldar_neoforge) loads on a dedicated server (run 7).
- P0 unverified:
  - The netty `VarInt` line in the Paper log at 13:51:04 (no client; likely Paper's own healthcheck ping; UNVERIFIED). The runbook has a one-minute watch for it.
  - PCF config owner: uid 1000 on a mode 600 file, against the Paper JVM's 1001 (observed; cause unverified).
- Next: P3, NeoForge adapter event export and maintenance notices (a design note is in progress). On hold: P4 and P5, progression (P6 to P8), and P0b.
- Human connection route: the lead asks the owner for it (separate approval; not requested here). Progression (P6 to P8) stays on hold.
- On hold: P0b (scratch golem-body and geldar-mcp for the Claude-mind test; the Mind-host route is not decided). P4 (own block-owner log and gravestones). P5 (BlueMap and pregeneration). P6 to P8 (progression): ON HOLD for the owner's six policy decisions in progression-design.md. Human connection route (tunnel or proxy): needs separate approval. CI lane for neoforge/: needs a separate owner-approved PR.
- Pins: NeoForge 26.1.2 (build 126); Proxy Compatible Forge 1.3.1.

## Lessons
- The repo IP-literal check rejects dotted four-number build strings; write "26.1.2 (build 126)".
- Reviewers caught a loaderVersion bug and an invalid sha512sum flag before any node run.
- The scratch phase0 stack has no golem-body or geldar-mcp (colo.yml only).
- The mc-proxy image runs as root with our UID setting, on live too. Compose comments that say the itzg image "drops to this uid" are true for Paper, not for the proxy.

## Open questions
- Confirm NeoForge 26.1 non-NeoForge handshake rules; the mirrors cover 1.20.4 to 1.21.5 only.
- Mind-host route, MCP listen address, port and dev token file for the scriptorium seam; owner approval for the human connection route (tunnel or proxy). (P0b, P0)
- Human vanilla client (P0 criterion 4): needs a separate approval.
- Many Bodies: join and load are not run.
- Registry absence, read from outside the probe.
- Online-mode UUID forwarding.
- A second start with the mod jar mounted.
- Progression decisions: the owner's six policy decisions (P6 to P8).
- Owner: whether the mc-proxy root setting is changed on live (a deploy change), and whether the PCF config owner must match the server user.

## Next actions
1. P3 is next (design note in progress). P0 runs 1 to 7 are done; run 7 passed.
2. Main orchestrator schedules the merge of this runbook and RESUME update after review.
3. P0b is written once the Mind-host-to-node route is decided.

Result: P0 probe run results (2026-11-17) are in [p0-findings.md](p0-findings.md).

Mind route options (how to connect a Claude Mind to the NeoForge shard, desktop rehearsal first, final instance later): [mind-route.md](mind-route.md).
