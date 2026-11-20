# 0241. Genesis bootstrap scope: the host only

- Status: Accepted
- Date: 2026-11-19
- Spec: none; `docs/spec.md` is not edited
- Related: 0240 (the scorched-earth drill), `docs/analysis/genesis/packets.md` (G3-01, GE-04, GE-10), `docs/analysis/genesis/plan.md`

## Context

G3-01 grew to cover the caddy install, the entrypoint install, the supervisor helper and the CI source bundle. Each of those needs its own review, and the bootstrap cannot prove them on a fresh host. Review round 2 (2026-11-19) asked for the cut to be written down.

## Decision

1. G3-01 bootstraps the host only: packages, the service and operator users and uids, the directory layout, the Docker address pools, time sync, sysctl, log rotation, unattended upgrades, the firewall and the docker group. It installs nothing from the repository.
2. The caddy install is G3-03.
3. The entrypoint install is GE-04b.
4. The supervisor helper is GE-04c (to be written).
5. The CI source bundle and the atomic switch are GE-10.
6. ENV_FILE is produced from `envs/<name>.yaml` by a later card (to be assigned in packets.md). G3-01 reads ENV_FILE and never writes it.

## Consequences

- G3-01's end state is the host alone. Its proof is the host proof: a fresh Debian VM, two runs, identical end state.
- The deferred items are named in the Deferred sentence of the G3-01 card in packets.md.
- Nothing in this record changes a secret, a key or an account.
