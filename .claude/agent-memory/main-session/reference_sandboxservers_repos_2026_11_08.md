---
name: reference_sandboxservers_repos_2026_11_08
description: The other Geldar repos in the SandboxServers org and how Phase 0 treats them
---

As of 2026-11-08 the SandboxServers org also has `geldar-infra`, `geldar-lantern`, `geldar-experiments`, `geldar-player-template` (marked as a template) and twelve public `player-*` repos, all empty README stubs. Spec section 6.6 instead puts `infra/` and `lantern/` inside this repo.

Phase 0 uses only this repo (`docs/decisions/0004-phase0-repo-layout.md`); the local Thinker is `lantern-local/` here. Whether `lantern/` and `infra/` move out is decided before Phase 2. Don't put code in the other repos without asking the owner.
