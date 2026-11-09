# 0004. Phase 0 code lives in this one repo

- Status: Accepted
- Date: 2026-11-08
- Spec: section 6.6

## Decision

Everything Phase 0 builds goes in `SandboxServers/geldar`, laid out as spec section 6.6, creating only the directories Phase 0 needs: `contract/`, `plugin/`, `golem/`, `animus/`, `lantern-local/`, `eventsink/`, `glass/`, `sql/`, `compose/`, `shards/`, `prompts/`. The local Thinker is `lantern-local/`, not `lantern/`: it is a plain WebSocket bridge to Ollama with no auth, not the signed Patron bundle.

## Why

Phase 0 is one machine and one weekend; one repo means one CI, one PR per change and one contract. The organization also has separate `geldar-infra`, `geldar-lantern` and `geldar-experiments` repos, created empty. The spec's 6.6 tree puts infra and the Lantern inside this repo instead.

## Consequences

- The separate repos stay untouched in Phase 0.
- Whether `lantern/` (the Patron bundle) and `infra/` move to their own repos is decided before Phase 2, when they are built.
