# NeoForge campaign (session geldar-neoforge) RESUME

State 2026-11-16. Read this, then [p0-body-model.md](p0-body-model.md).

## State
- Freeze lifted for own docs/analysis and own-area PRs. No node, VM or world changes by this session; node steps run by the main orchestrator or ops after the owner's explicit go.
- P0 node run is in progress on the Colo scratch stack, suffix nf, run by ops under geldar-93 (owner approved). It stops at the first failure. The raw report goes to geldar-93; findings are written up here afterwards.
- No decision numbers until the main orchestrator assigns a block.

## PRs
- Merged: #593 (P0 Body-model note), #594 (API notes and progression design), #596 (P2 plugin/core split: core-common, Paper adapter, golden jar guard), #600 (scratch NeoForge overlay, suffix nf, loopback RCON, entrypoint with sha512/sha256 pins), #601 (neoforge/ skeleton: NeoForge 26.1.2 (build 126), Java 25, ModDevGradle 2.0.148, Gradle 9.8.2, loaderVersion [11,), dependency verification and locking; the CI lane came later, see below), #604 (earlier RESUME), #607 (installer fetch retry), #610 (scratch uid fix: SCRATCH_RUN_UID/GID), #611 (offline bundle: deploy/scratch/build-neoforge-bundle.sh and strict entrypoint bundle mode; node cannot reach maven.neoforged.net), #614 (declared source-scan inputs for plugin/core tests, so read-only guard tests rerun on source change).
- Open, CI running: #619 (message-only fix for the verifyTestSourceInputs failure text). The main orchestrator schedules its merge after P0.

## Packets
- P0 join test (in progress): golem Body joins the scratch NeoForge server through Velocity. Ops runs `SCRATCH_PLATFORM=neoforge ... scratch.sh up nf`, then golem live registry and goto with the nf port block (docs/runbooks/scratch-stack.md, NeoForge section).
- P0 unverified until the node run:
  - itzg "already installed" with the bundle, and an offline second start.
  - Privilege drop to the account uid.
  - NATS reading the 0600 auth file.
  - eventsink /app readability.
  - Vanilla-client join and the UUID the server sees on 26.1.
  - Proxy Compatible Forge accepting the config layout.
  - Our mod loads.
  - Forwarding config mode 600 on Linux.
- P0b: scratch golem-body and geldar-mcp for the Claude-mind test. On hold until the Mind-host-to-node route is decided. The scratch phase0 stack has no golem-body or geldar-mcp (colo.yml only).
- P3: NeoForge adapter event export and maintenance notices. On hold, after P0.
- P4: own block-owner log and gravestones. P5: BlueMap and pregeneration. On hold.
- P6 to P8 (progression): ON HOLD for the owner's six policy decisions in progression-design.md.
- CI lane for neoforge/ and neoforge-ledger/: the `neoforge` job in ci.yml (owner-approved; first real run pending, branch protection needs no change because `ci gate` already requires it).
- Human connection route (tunnel or proxy): on hold, needs separate approval.
- Pins: NeoForge 26.1.2 (build 126); Proxy Compatible Forge 1.3.1.

## Lessons
- The repo IP-literal check rejects dotted four-number build strings; write "26.1.2 (build 126)".
- Reviewers caught a loaderVersion bug and an invalid sha512sum flag before any node run.
- The scratch phase0 stack has no golem-body or geldar-mcp (colo.yml only).

## Open questions
- Does a vanilla-protocol golem Body join a NeoForge 26.1.2 server behind Velocity with no registered payloads? Which UUID and name does it see? (P0)
- Confirm NeoForge 26.1 non-NeoForge handshake rules; the mirrors cover 1.20.4 to 1.21.5 only.
- Mind-host route, MCP listen address, port and dev token file for the scriptorium seam; owner approval for the human connection route (tunnel or proxy). (P0b, P0)

## Next actions
1. Ops completes the P0 node run under geldar-93; raw report goes to geldar-93, then findings are written up here and in p0-body-model.md.
2. Main orchestrator schedules the merge of #619 after P0.
3. P0b is written once the Mind-host-to-node route is decided.
