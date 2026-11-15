# Genesis resume

Read this first, then [README.md](README.md) and [plan.md](plan.md). Keep it under 40 lines; rewrite at each wave boundary.

## Where it is (2026-11-14)

- Planned, nothing built. 39 cards in waves G0 to G7 ([packets.md](packets.md)), architecture decision [0188](../../decisions/0188-genesis-environment-stamp.md) (Proposed).
- Owner decisions taken: targets (production rebuild, second environment, ephemeral CI stamp); DNS and Entra automated, gateway firewall a checked prerequisite; start from a clean Debian host; secrets generated on the host (Key Vault only for secrets that outlive a host); the second environment is a new Hyper-V Debian VM on node 3 created by an operator-run script; ranger kit hosts out of scope (a real ranger on the test world is the owner's human acceptance); the Azure pieces live in this repo.
- G0-02 is measured: the reduced boot (Postgres, NATS, Paper) fits the hosted runner with large headroom; the full-stack stamp awaits a second measurement in G6-04 ([g0-02-runner-spike.md](g0-02-runner-spike.md)).
- Open: backup destination and credential; test VM sizing and network; Azure DNS role and command (G2-06, first real run); full-stack runner fit (G6-04). G0-01 is resolved by the owner ruling (2026-11-14); the federated-identity use is verified at the first G2-05 run.
- Review of this plan: geldar-ops, geldar-registration and scriptorium-orchestrator are folded in (branch head at the time of handoff: the latest commit on `phase1/genesis-plan`). geldar-93 reviews on the evening of 2026-11-14.
- **Owner**: handed to the new session `geldar-genesis` (owner ruling: one campaign per coordinator). Decision numbers for this campaign: 0240-0249 (0188 is already used). Every migration card inherits the rule in G4-03.

## Coordinator log

- 2026-11-14: geldar-genesis took over. Asked geldar-3b for inventory; sent the plan and questions to geldar-93. The node-learned facts were added to plan.md section 8 (stale compose and jar hashes, hand-copied jars, "needs manual" list, no tested world backup, non-reproducible items); ask the owner for backup destination and VM sizing.
- 2026-11-14: owner ruling on G0-01 (`OwnedBy` covers app operations on apps the bootstrap app created; stated by the owner, not run by us). geldar-worldops runbooks on main: docs/runbooks/node-only-config.md (15 node-only items with a reproduction order) and docs/runbooks/nats-auth-inplace.md (in-place NATS update; a reload closing live sessions on nats 2.15.1 is unverified). Genesis cards G2-02, G7-01 and G4-03 must use them; the node has no Node runtime and no /opt/geldar until helper delivery C7-03c5. Backup destination: another LAN node (owner, 2026-11-14). Test VM: 24 GB RAM, 8 vCPUs (owner).

## Next action

1. Open the docs PR and queue it.
2. G0-02 (runner capacity) is done. Start G0 spike G0-01 (Entra and DNS), then G0-04, G0-03, G0-05 as packets.

## Rules

Nothing reaches the live node outside geldar-93's window; production is never rebuilt in place; no secrets, account names or addresses in the repo; the workflow changes only through owner-approved PRs; cards that regenerate contract/ need a slot from geldar-3b.
