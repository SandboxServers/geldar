# Genesis resume

Read this first, then [README.md](README.md) and [plan.md](plan.md). Keep it under 40 lines; rewrite at each wave boundary.

## Where it is (2026-11-14)

- Planned, nothing built. 39 cards in waves G0 to G7 ([packets.md](packets.md)), architecture decision [0188](../../decisions/0188-genesis-environment-stamp.md) (Proposed).
- Owner decisions taken: targets (production rebuild, second environment, ephemeral CI stamp); DNS and Entra automated, gateway firewall a checked prerequisite; start from a clean Debian host; secrets generated on the host (Key Vault only for secrets that outlive a host); the second environment is a new Hyper-V Debian VM on node 3 created by an operator-run script; ranger kit hosts out of scope (a real ranger on the test world is the owner's human acceptance); the Azure pieces live in this repo.
- Open: backup destination and credential; test VM sizing and network; hosted-runner fit (G0-02); Entra `OwnedBy` redirect-URI coverage (G0-01).
- Review of this plan: geldar-ops, geldar-registration and scriptorium-orchestrator are folded in (branch head at the time of handoff: the latest commit on `phase1/genesis-plan`). geldar-93 reviews on the evening of 2026-11-14.
- **Owner**: handed to the new session `geldar-genesis` (owner ruling: one campaign per coordinator). Decision numbers for this campaign: 0240-0249 (0188 is already used). Every migration card inherits the rule in G4-03.

## Next action

1. Collect geldar-93's review and fold in changes.
2. Merge this plan PR to `main` (docs only, no deploy).
3. Dispatch the G0 spikes first: G0-01 (Entra and DNS), G0-02 (runner capacity), then G0-04, G0-03, G0-05 as packets.

## Rules

Nothing reaches the live node outside geldar-93's window; production is never rebuilt in place; no secrets, account names or addresses in the repo; the workflow changes only through owner-approved PRs; contract-regenerating cards run strictly one after another.
