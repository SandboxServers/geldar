# NeoForge campaign (session geldar-neoforge) RESUME

State 2026-11-16. Read this, then [p0-body-model.md](p0-body-model.md).

## State
- Freeze lifted for own docs/analysis PRs. No node, VM or world changes.
- No decision numbers until the main orchestrator assigns a block.
- Branches: phase1/nf-scratch-overlay (scratch overlay, suffix nf) and phase1/nf-p0-note (the P0 note and this file).
- A review artifact exists as a private claude.ai page. It is not linked from the repo.

## Packets

| Packet | Scope | Depends on |
|---|---|---|
| P0 | Join test: golem Body joins the scratch NeoForge server through Velocity (node step by orchestrator) | none |
| P0b | Scratch Body and MCP for the Claude-mind test | P0 |
| P1 | Caps and compose | P0 |
| P2 | Split plugin into a core neutral module | none |
| P3 | NeoForge adapter: event export and maintenance notices | P2, P0 |
| P4 | Own block-owner log and gravestones | P3 |
| P5 | BlueMap and pregeneration | P1 |
| P6 | Progression mod skeleton | P0 |
| P7 | MCP text for progression (contract edit via orchestrator) | P6 |
| P8 | Contracts and reputation; bench with two agents and one human | P6, P7, P4 |

Pins: NeoForge 26.1.2 (build 126); Proxy Compatible Forge 1.3.1.

## Open questions
- Does a vanilla-protocol golem Body join a NeoForge 26.1.2 server behind Velocity with no registered payloads? (P0)
- Which UUID and name does the server see for the golem Body? (P0)
- Confirm the NeoForge 26.1 non-NeoForge handshake rules; the mirrors cover 1.20.4 to 1.21.5 only.
- How does the Mind host reach the node? (P0b)
- Which MCP listen address, port and dev token file does the scriptorium dev seam need? (P0b)
- Owner approval for the human connection route (tunnel or proxy). (P0, criterion 4)

## Next actions
1. Owner decides options (a) to (d) in the P0 note, section 9.
2. Orchestrator runs the P0 join test on the scratch stack if approved.
3. Write P0b after P0 results are recorded.
