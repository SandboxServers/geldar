# Genesis resume

Read this first, then [README.md](README.md) and [plan.md](plan.md). Keep it under 40 lines; rewrite at each wave boundary. Card states are in the Ledger at the top of [packets.md](packets.md).

## Where it is (2026-11-18)

- Waves G0 and G1 are merged except G0-06 (satisfied by [0240](../../decisions/0240-genesis-exit-is-the-scorched-earth-drill.md)) and G1-04 (release manifest v2, in progress, coder dispatched 2026-11-18).
- Exit criterion ([0240](../../decisions/0240-genesis-exit-is-the-scorched-earth-drill.md)): the scorched-earth drill. Delete every Geldar-owned host, VM, volume, container, network, secret, DNS record, Entra app and runner; keep only GitHub and the owner's bootstrap credential; regenerate from pipelines; verify and the smoke suite pass; a ranger can join.
- Scope: Geldar-owned things only. Shared host services (ClickHouse, SigNoz, the telemetry gateway, GitHub runner stacks, other projects) are prerequisites, not stamped (owner, 2026-11-18).
- Cards GE-01 to GE-10 are added (wave GE in [packets.md](packets.md)); GE-04 is in progress, the rest not started.
- 2026-11-18 progress: G1-04, G2-01, G2-03, G2-04, G2-06, G3-02 and GE-04 marked in progress (coder dispatched); GE-01 and GE-02 text extended (extra-mods landed #750; velocity-identity jar hand-swapped).
- 2026-11-18 rule: no overnight step touches the node or Azure; overnight work is repo and docs only.
- The NeoForge shard (0386 to 0388) was built after the plan. The node source tree is a hand-synced snapshot; NeoForge mod folders are hand-staged.
- Gap map artifact: https://claude.ai/artifact/1tVqhJTF3FZVMgu6rzKzxj
- Test VM: Hyper-V Debian on node 3, 24 GB RAM and 8 vCPUs; backups go to another LAN node (owner). `Application.ReadWrite.OwnedBy` covers app updates (owner ruling 2026-11-14, not run by us).

## Next actions, in order

1. G1-04 (release manifest v2). Tell geldar-93 before queueing; colo-cd must ignore unknown keys.
2. GE-01 and GE-02.
3. G2 to G4, with GE-03 to GE-05.
4. GE-06 and GE-07.
5. G5 to G7, and GE-09 (the drill).

## Open for the owner

- Whether the drill must preserve the NeoForge world (a backup and restore design; today none exists; GE-06).
- The skins source.
- G2-04 Environments and identities (the owner runs them).
- The first DNS and Entra run (G2-05, G2-06) needs the owner's tenant.
- The backup credential (write-only, G5-01).

## Coordination

- geldar-93 owns the node and the deploy queue; geldar-registration owns the body-helper and supervisor work.

## Rules for queueing

- Nothing reaches the live node outside geldar-93's deploy window. No deploy may be running when a PR is queued.
- Tell geldar-93 for every deploy-path PR. Workflow PRs say "touches .github/workflows" in the title or body.
- Production is never rebuilt in place. The workflow changes only through owner-approved PRs.
- No secrets, account names or addresses in the repo.
