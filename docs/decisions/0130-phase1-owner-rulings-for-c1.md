# 0130. Phase 1 owner rulings for C1 and the test schedule

- Status: Accepted (owner ruling, 2026-11-10)
- Date: 2026-11-10
- Spec: section 6.8 (backups), section 10 (Phase 2 gate, restore on a scratch shard). Decisions 0076, 0078, 0080 (accepted the same day), 0070 (invite-only colo shard). Phase 1 plan: `docs/analysis/phase1/plan.md`.

## Problem

The C1 and C3 packets left five owner questions open: the deploy access, the backup destination, the telemetry endpoint, and the length of the soak (O-soak) with the chaos day and the long benchmarks. The owner answered them on 2026-11-10. The answers change what the packets build now and what they run later, so they are recorded here rather than only in the packets.

## Rulings

The owner's answers, as given:

1. **Deploy access (C1-04, C1-10).** "Use a runner or the ssh access." Deploys reach the Colo node through a self-hosted runner or the owner's existing SSH access. No new deploy account is created.
2. **Backups (0076, C1-05b).** "Defer backups for now." The backup destination (D1, D2 or D3) and the backup v1 build are deferred. Scope B of 0076 is accepted. The journal append-only change (C1-05a) is not deferred.
3. **Telemetry (C1-07).** "Use signoz." The telemetry endpoint is the SigNoz instance on the Colo node. Its URL is configuration (`GELDAR_TELEMETRY_URL`) and does not go in the repo.
4. **Long-running tests (C3-07, C3-09, C3-10, C4-08).** "Defer all long running tests until the end of the phase." The following run once, at the end of the phase, as campaign-boundary gates, and not at each wave boundary:
   - the 7-day soak of 10 to 15 agents;
   - the chaos day;
   - the N-bot long benchmark;
   - the restore-time tests;
   - the 20-minute-plus Adam smoke.

   Per-wave gates keep only short tests (a smoke of five minutes or less, and the real-client live run at each wave boundary).

## Decision

- The soak is **one soak, at the end of the phase**: the 7-day run in plan.md. The 72-hour soak gate proposed in the C3 cards (C3 section 8, C3-10) is withdrawn. O-soak in the C3 and C4 packets is resolved as this.
- The chaos day, the N-bot long benchmark and the restore-time tests are campaign-boundary gates at the end of the phase. C3-07, C3-09 and C3-10 still build their tooling in their waves, and run it at the campaign end.
- Deploys use the runner or SSH (ruling 1). No deploy account is requested.
- The backup build and destination are deferred (ruling 2). 0076 is accepted with that note.
- Telemetry goes to the node's SigNoz (ruling 3).

## Consequences and risks

- **No backups while the shard runs.** Until a backup exists, a running Colo shard has no restore path. The shard stays invite-only and unannounced (0070), and nothing irreplaceable lives on it. The restore test cannot run before the end of the phase, and the backup build must exist before then. When to schedule the build is the owner's call.
- **Late discovery of stability problems.** A 7-day soak and a chaos day at the end of the phase find problems late. Mitigations: keep a short smoke (five minutes or less) in every wave gate, and run the real-client live run at each wave boundary. A failed end-of-phase soak returns work to the wave that owns the failure; it is not waived.

## What changes in the packets

- `docs/decisions/0076-backup-scope-and-destination.md`: accepted; owner ruling paragraph (destination and build deferred).
- `docs/decisions/0078-mind-placement-for-phase1.md`, `0080-nats-auth-cutover.md`: accepted.
- `docs/analysis/phase1/packets/c1-packets.md`: C1-05b deferred (banner, ledger row); C1-10 restore test moved to the end-of-phase gates; the C1 wave-boundary gate drops the restore test; the owner questions on the deploy account, the backup destination and the telemetry endpoint answered.
- `docs/analysis/phase1/packets/c3-packets.md`: O-soak resolved; soak, chaos day and N-bot long benchmark moved to the end-of-phase campaign gates; C3 wave-boundary gate keeps short tests only; C3-07, C3-09, C3-10 build now and run at the campaign end.
- `docs/analysis/phase1/packets/c4-packets.md`: O-soak resolved; the 7-day run is the single end-of-phase soak.
- `docs/analysis/phase1/plan.md`, `ledger.md`, `RESUME.md`, and `packets/decision-number-registry.md`: updated to match. `docs/spec.md` is not changed.

## Unblocks

- C1-04 (deploy by runner or SSH), C1-07 (telemetry to SigNoz), and the C1 and C3 wave-boundary gates without the long tests.
- C1-10 minus the restore test and the long runs; the restore test and the soak move to the end-of-phase gates.
