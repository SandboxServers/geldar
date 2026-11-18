# 0240. Genesis: the exit is the scorched-earth drill

- Status: Accepted (owner stated the goal and the scope in chat, 2026-11-18)
- Date: 2026-11-18
- Spec: none; `docs/spec.md` is not edited
- Related: 0188 (stamp architecture, stays Proposed and gains this scope), 0386, 0387, 0388 (the NeoForge shard), 0342 (restart policy), `docs/analysis/genesis/` (README, plan, packets, RESUME)

## Context

The owner's words (2026-11-18): genesis is done when everything for Geldar, everywhere that is not GitHub, could be deleted and regenerated from one or more CI pipelines. That includes community mods for NeoForge and community plugins for Paper. Our own mods and plugins must also be deployed by CI. Every manual step must be replaced by CI or by an equivalent owner function (register or glass, as registration does).

Today the live node is assembled by hand. Jars are copied, a `.bak` rollback is kept by hand, the node's source tree is a hand-synced snapshot, NeoForge mod folders are hand-staged, and several steps are "needs manual" in the colo deploy. The exit run in `docs/analysis/genesis/plan.md` section 9 covers a new environment on a clean VM; it does not yet cover the whole node.

## Decision

1. **Exit criterion = the scorched-earth drill.** Delete every Geldar host, VM, volume, container, network, secret, DNS record, Entra app and runner owned by Geldar. Keep only GitHub (repositories, Environments) and the single owner-held bootstrap credential. Regenerate everything from pipelines only. The drill passes when verify and the smoke suite pass and a ranger can join.
2. **Scope is only Geldar-owned things.** Shared services on the host are prerequisites and are not stamped: the telemetry stack (ClickHouse and SigNoz), the telemetry gateway, the GitHub runner stacks and other projects. The owner agreed this on 2026-11-18. The stamp must still not break them.
3. **No hand-placed artifact.** Every jar and mod (ours and community; Paper, NeoForge and Velocity) is built or fetched by CI, locked in the repo with digests, verified and placed by the pipeline. No `scp`, no `docker cp`, no hand-built tarball.
4. **No manual node step.** Each step becomes a workflow job or an audited owner function in register or glass (supervisor over NATS). A runbook may explain a step, but never performs it.
5. **State restores; secrets regenerate.** Postgres, both worlds, the skins bucket, tokens and the roster restore from an off-host backup during the drill. Secrets are regenerated on the target.
6. **Drift is reported.** A scheduled plan job reports drift and fails on a hand edit.
7. **Allowed leftovers are checked prerequisites, not steps:** the gateway firewall policy, the domain registration and the owner's one-time tenant consent.
8. **Open questions stay open** until the owner rules. They stay open: the NeoForge world's "no backup" decision (from the pregeneration note) and the skins source. They are listed in `docs/analysis/genesis/README.md` under open owner questions.

## Why

A rebuild that cannot be run from the repo is not a backup of the system. A drill that deletes everything Geldar owns is the only test that proves each step is in code, and it turns the owner's goal into one pass or fail. Limiting the scope to Geldar-owned things keeps the shared telemetry and runner services working, so the drill can run on the same host.

## Consequences

- 0188 stays Proposed and gains this scope: the stamp must cover mods, plugins, the node source tree and the owner functions, not only compose and config.
- Cards GE-01 to GE-10 (wave GE in `docs/analysis/genesis/packets.md`) are added. The G0-06 record is satisfied by this decision.
- The node's hand-synced source snapshot and its hand-staged mod folders must be replaced by CI-published artifacts (GE-04, GE-10).
- Drill runs go to the Hyper-V test VM first and to production last (GE-09).
