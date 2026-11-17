# NeoForge campaign (session geldar-neoforge) RESUME

State 2026-11-16 evening. Read this, then [p0-body-model.md](p0-body-model.md).

## State
- Freeze lifted for own docs/analysis and own-area PRs. No node, VM or world changes by this session; node steps run by the main orchestrator or ops after the owner's explicit go.
- No decision numbers until the main orchestrator assigns a block.

## PRs
- Merged: #593 (P0 Body-model note), #594 (API notes and progression design).
- Open, green: #596 (P2 core-common split plus Paper adapter; the main orchestrator schedules its merge; not a colo-images path).
- Open, green: #600 (scratch NeoForge overlay, suffix nf, loopback RCON, entrypoint with sha512/sha256 pins; ops queues it via the main orchestrator).
- Open, green: #601 (neoforge/ skeleton: NeoForge 26.1.2 (build 126), ModDevGradle 2.0.148, Gradle 9.8.2, loaderVersion [11,), dependency verification and locking; no CI lane).
- Local, not a PR: phase1/nf-readonly-inputs, stacked on #596 (declares scanned source roots as test inputs so read-only guard tests rerun on source change). Open after #596 merges.

## Packets
- P0 join test: golem Body joins the scratch NeoForge server through Velocity. Needs owner go and runbook prerequisites. Ops runs `SCRATCH_PLATFORM=neoforge ... scratch.sh up nf`, then golem live registry and goto with the nf port block (docs/runbooks/scratch-stack.md, NeoForge section).
- P0b: scratch golem-body and geldar-mcp for the Claude-mind test. On hold until the main orchestrator and owner decide the Mind-host-to-node route.
- P2: done (#596).
- P3: NeoForge adapter event export and maintenance notices. After P0.
- P4: own block-owner log and gravestones. P5: BlueMap and pregeneration.
- P6 to P8 (progression): ON HOLD for the owner's six decisions in progression-design.md.
- Pins: NeoForge 26.1.2 (build 126); Proxy Compatible Forge 1.3.1.

## Lessons
- The repo IP-literal check rejects dotted four-number build strings; write "26.1.2 (build 126)".
- The scratch phase0 stack has no golem-body or geldar-mcp (colo.yml only).
- Reviewers caught a loaderVersion bug and an invalid sha512sum flag before any node run.
- Unverified until the node run: itzg image tools, mod TOML layout, server loads our mod, vanilla join and UUID.

## Open questions
- Does a vanilla-protocol golem Body join a NeoForge 26.1.2 server behind Velocity with no registered payloads? Which UUID and name does it see? (P0)
- Confirm NeoForge 26.1 non-NeoForge handshake rules; the mirrors cover 1.20.4 to 1.21.5 only.
- Mind-host route, MCP listen address, port and dev token file for the scriptorium seam; owner approval for the human connection route (tunnel or proxy). (P0b, P0)

## Next actions
1. Main orchestrator merges #596 and ops queues #600.
2. On owner go, ops runs the P0 join test and records results in p0-body-model.md, then P0b is written.
3. Open the phase1/nf-readonly-inputs PR after #596 merges.
