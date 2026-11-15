# Genesis resume

Read this first, then [README.md](README.md) and [plan.md](plan.md). Keep it under 40 lines; rewrite at each wave boundary. Card states are in the Ledger at the top of [packets.md](packets.md).

## Where it is (2026-11-15)

- Wave G0 is mostly merged (G0-02 done, G0-03a to d, G0-04, G0-05). G0-06 is not started. Wave G1: G1-01 and G1-02 merged; G1-03 is merged 2026-11-15 06:02Z (3c563c72) as #454.
- Architecture decision [0188](../../decisions/0188-genesis-environment-stamp.md) is still Proposed. Decision numbers for this campaign: 0240-0249. The full-stack runner fit waits for G6-04.
- Handed to the session `geldar-genesis`, one campaign per coordinator.

## Decisions taken

- Targets: rebuild production from nothing, a second environment, and an ephemeral CI stamp. DNS and Entra are automated; the gateway firewall stays a checked prerequisite.
- Backups go to another LAN node (owner, 2026-11-14).
- Test VM: Hyper-V Debian on node 3, 24 GB RAM and 8 vCPUs (owner).
- OwnedBy ruling (owner, 2026-11-14, not run by us): `Application.ReadWrite.OwnedBy` covers redirect-URI and credential operations on apps the bootstrap app created.

## Lessons

- Paper's secret files must be readable by uid 1000. Compose ignores `uid` and `mode` on file secrets, so check readability inside a container.
- Waits must fail hard: a timeout exits non-zero, never passes.
- Test literals must resolve parameterised ports; do not hard-code the default port in an assertion.
- Ops agents must not run the full local check on Windows. CI is the verdict.
- Before queueing a PR, check for a running colo-deploy in its own step.

## Rules for queueing

- Nothing reaches the live node outside geldar-93's deploy window. No deploy may be running when a PR is queued.
- Tell geldar-93 for every deploy-path PR.
- Workflow PRs say "touches .github/workflows" in the title or body.
- Production is never rebuilt in place. The workflow changes only through owner-approved PRs.
- No secrets, account names or addresses in the repo.

## For the owner

- The first DNS and federated-identity run (G2-05, G2-06) needs the owner's tenant.
- The GitHub Environments and Azure identities in G2-04 are run by the owner.

## Next actions

1. G1-04 (release manifest v2).
2. G2-01, then G2-02 (coordinate with geldar-vitals on Get-NatsUsers).
3. G2-03, G2-04.
4. G3-01 to G3-04.
5. G4 (stamp workflow).
