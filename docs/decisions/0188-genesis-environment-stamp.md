# 0188. Genesis: a whole environment is stamped from a workflow, from a definition in the repo

- Status: Proposed (owner answers recorded 2026-11-14 in the genesis campaign README; the architecture awaits review by geldar-93, geldar-ops, geldar-registration and scriptorium)
- Date: 2026-11-14
- Spec: section 10 (phases); related decisions 0070, 0071, 0073, 0108, 0170 to 0173
- Related: `docs/analysis/genesis/` (README, plan, packets)

## Context

Production today is assembled by hand: plugin jars are built on a desktop and copied, secrets and the NATS auth file are made on the desktop and copied, the gateway policy, DNS records, the Entra app, the shared Caddy and Docker network pools are hand-made, and no world or JetStream backup or restore test exists. A second independent environment cannot be created because ports, paths, project names and ids are fixed. The owner asked for a full genesis of the infrastructure from CI: Paper, plugins, configs, bodies, MCP, everything accounted for and deployable from the repo.

## Decision

1. An **environment is a value**: `envs/<name>.yaml`, validated by a contract schema, holding no secret, account name or address. Operator inputs and secrets are named by reference.
2. One reusable `stamp.yml` workflow (dispatch only, protected GitHub Environments, one concurrency group per environment, actions pinned by SHA) with modes `plan`, `apply`, `verify` and `restore`. Apply is ordered and idempotent: a second apply is a no-op.
3. The target receives **artifacts by digest**: plugin jars and a config bundle built by CI, third-party jars by lock file with sha256 and sha512. No hand copies.
4. **Secrets are generated on the target**, create-if-missing, never rotated silently. Only secrets that must outlive a host (the Entra client secret, the backup key) also live in a per-environment Azure Key Vault. NATS users and Postgres roles are created from the repo on the target. An existing node is adopted, never regenerated.
5. **DNS records and the Entra sign-in app are automated** with per-environment Azure OIDC identities (no stored password), the bootstrap Entra app limited to `Application.ReadWrite.OwnedBy`, DNS Zone Contributor on the one zone. The gateway firewall and port forward remain a checked prerequisite. Scopes and holders are listed in plan.md section 6.
6. The deploy channel is a GitHub-hosted job reaching the target over SSH with a per-environment key whose entry forces one wrapper command. The existing self-hosted runner path stays for the live node until cutover.
7. **Targets**: rebuild production from nothing, a second independent environment (first a Hyper-V Debian VM on node 3, created by an operator-run script that CI never runs), and an ephemeral stamp inside CI. A stamp starts from a clean Debian host with SSH.
8. **Production is never rebuilt in place.** It is described by `envs/colo.yaml` and compared by a read-only drift report; a rebuild goes to a spare host and cutover is the owner's decision in its own window.
9. Ranger kit hosts are out of scope (scriptorium). A stamp verifies with a scripted test player and no model. A real ranger connected to the test world is the owner's human acceptance.
10. Backups with an off-node copy and a restore drill in CI are part of the campaign, not a follow-up.

## Why

Idempotent plan and apply, per-environment identities and a forced-command channel give a rebuild that can be reviewed and re-run, with the smallest credentials in CI. Adopting rather than regenerating protects the live NATS users and Postgres volumes. Making the environment a value lets one workflow stamp production, test and ephemeral copies the same way.

## Consequences

- 38 cards in waves G0 to G7. Compose gains parameterisation and the `loopback-ports` repo check changes to allow a named, defaulted form.
- Migrations or contract changes in the cards use numbers from the registry and reach the node only in windows from geldar-93.
- The workflow and its permissions change only through PRs the owner approves.

## Open

Backup destination and its credential; test VM sizing and network; hosted-runner fit for the ephemeral stamp; whether the Entra `OwnedBy` permission covers redirect-URI edits (spike G0-01); whether the live node adopts the stamp channel after the drift report is clean; unverified research points listed in plan.md.
