# Genesis plan

Companion to [README.md](README.md) (goal, decisions, waves) and [packets.md](packets.md) (cards). Facts below come from the repo at `origin/main` (2026-11-14), from the interviews listed in the README, and from online research (sources in section 10). Anything not verified is marked **unverified** and has a spike card in G0 that settles it before a dependent card is dispatched.

## 1. What exists today (verified)

- **Images**: `colo-images` builds and pushes `ghcr.io/sandboxservers/geldar-*` (body, mind, eventsink, mcp, admin, glass, register) on push to `main`, and writes a release manifest. `colo-deploy` runs on the node's self-hosted runner (`geldar-colo-deploy`, environment `colo`) through a sudo wrapper and `deploy/colo-cd.sh`: images, migrations after a `pg_dump`, one-at-a-time Body host refresh, rollback of images. It never restarts Paper, Velocity, Caddy, Postgres or NATS and prints "needs manual" for plugin, compose, Caddy or NATS changes.
- **Compose**: `compose/colo.yml` (project `geldar-colo`, loopback ports 25567, 8788, 18090, 8787, 8100 as literals, a CPU and memory limit on every service) with overlays; `compose/phase0.yml` for local. Postgres initialises from `sql/` only on a fresh volume; later migrations run through `tools/migrate`.
- **Secrets**: `deploy/gen-secrets.sh` creates 10 secret files if missing (mode 0600). NATS password files and `nats-auth.conf` come from `geldar.ps1 shard nats-auth`, run on the **desktop** and copied by hand; the user list is code (`Get-NatsUsers`, `geldar.ps1:370`). The Entra client secret file is owner-supplied.
- **Paper**: image pinned by digest (`itzg/minecraft-server`), Paper 26.1.2 build 74, `SEED 8675309`, offline mode behind Velocity. `geldar-core` and `velocity-identity` jars are built on the desktop and `scp`'d. BlueMap, Chunky and CoreProtect jars are fetched and checked against `plugins/*/*.lock.json` by `deploy/common.sh` (sha256 checked; sha512 present but not checked).
- **Postgres roles**: created by migrations and by hand (`geldar_supervisor` password is a hand step).
- **Not in git, only on the node or in heads**: the release manifest at `/etc/geldar-colo/release.env`, the secrets directory, `nats-auth.conf` passwords, CoreProtect config, the kino skins and MineSkin JSON, the shared Caddy and its reload, the UniFi forward and gateway policy, Azure DNS records, the Entra app, hand-set permissions, Docker network address pools, per-player token files on the desktop.
- **Backups**: a pre-migration `pg_dump` into `state/backups` (no retention, no off-node copy). No world backup, no JetStream backup, no restore ever tested; rollback restores images only.
- **CI boots**: the `integration` job starts Postgres, NATS and the eventsink (no compose stack). No workflow boots Paper.

## 2. What blocks a second environment today (verified)

Literal loopback ports (the compose repo-check forbids interpolation for them); fixed project, network, volume and subnet names; host paths `/var/lib/geldar-colo`, `/mnt/nvme/geldar-colo`, `/var/lib/geldar-deploy`; the sudo path and runner label; the repo gate `SandboxServers/geldar` and image names; one OAuth callback URL per Entra app; one Postgres and NATS per environment because roster names and `ag-<name>-01` ids are global per database; `shard nats-auth colo` generated on the desktop; `SEED` and `GELDAR_SHARD` defaults.

## 3. Architecture

**An environment is a value.** `envs/<name>.yaml` (non-secret, validated by a contract schema): environment name, project name, hostnames, ports, paths, subnet, versions and image digests, feature flags (kill switch, Kino, Mind profile), the roster source, and the verification profile. Secrets and operator inputs are **not** in it; they are named by reference. The live node gets an `envs/colo.yaml` written to match what runs today (G7-01 proves it).

**One workflow, three modes.** `stamp.yml` (reusable, `workflow_dispatch` entry, inputs `environment`, `ref`, `mode`): `plan` (diff the target against the definition and report drift, change nothing), `apply` (converge), `verify` (the smoke suite). Concurrency group per environment, no cancel-in-progress. The job declares `environment: <name>`, so GitHub Environment protection (required reviewer, branch restriction) applies and the OIDC `environment:` claim scopes cloud access per environment.

**Apply order** (each step idempotent and re-runnable): host bootstrap → images and config bundle → secrets (create-if-missing) → NATS config and users generated on the target → Postgres up, roles, migrations (dump first) → seed (roster, owners) from operator inputs → Paper first start (world from seed) → plugins (jars by digest) → Velocity → edge (Caddy snippet, DNS) → services (eventsink, MCP, register, Glass) → Body hosts → verify.

**Artifacts, not hand copies.** CI builds the two plugin jars and a **config bundle** (compose files, shard files, plugin configs, Caddy snippets, deploy scripts) and publishes them with a digest into the release manifest. The target pulls by digest. Third-party jars keep the lock-file path, with sha512 checked as well.

**State and recovery.** Scheduled `pg_dump` (custom format) and a JetStream stream backup to an off-node location, a world archive, retention, and a **restore drill** in CI that restores into an ephemeral container and runs the schema checks. A stamp has a `restore` mode that stamps and then restores the backups.

**Deploy channel.** A GitHub-hosted job reaches the target over SSH with a key whose `authorized_keys` entry forces one wrapper command (no shell), per environment. The existing self-hosted runner path stays for the live node until cutover (the node stays on its window process). Research recommends against self-hosted runners that share a host with production for PR-triggered work; the stamp workflow is dispatch-only.

**Ephemeral CI stamp.** On a hosted runner (4 vCPU, 16 GB for a public repo; the repo is public) run Postgres, NATS, the services, a reduced Paper (small world, low memory) behind Velocity, and the scripted test player. **Unverified** that Paper plus the stack fits: spike G0-02.

## 4. Test environment on node 3

The owner wants a Hyper-V Debian VM on node 3 as the first non-production stamp, built from a fresh install with no dependencies pre-installed, ending with bodies connected and a real ranger on the test world. Plan: G3-04 creates the VM (PowerShell over SSH from an operator machine that holds the node 3 key; CI does not hold it); G3-01 bootstraps from bare Debian; G4 stamps it; G6 verifies it with the scripted test player; the owner then points a real ranger at it as acceptance (human step, scriptorium side).

## 5. Principles

Idempotent everywhere (create-if-missing, upsert, no silent rotation); plan before apply; no secret in the repo, an input, a log or a summary (mask, pipe, never echo); least privilege per environment; every apply is a recorded run with the commit and the definition hash; the live node is never rebuilt in place.

## 6. Credentials the workflow holds, scopes and holders (names only, nothing in the repo)

| Credential | Scope | Holder and where it lives | Notes |
|---|---|---|---|
| GitHub Environment `<name>` (one per environment) | protects the stamp job; required reviewer; branch restriction | repo owner (GitHub settings, manual once) | defines which environment can use which identity |
| Deploy SSH key per environment | forced command on the target's `authorized_keys`, one wrapper | private key in the GitHub Environment secret; public key installed by bootstrap | key cannot give a shell; rotate by re-running bootstrap |
| Azure OIDC identity per environment (workload identity, federated credential, subject `environment:<name>`, plus repository id) | production: DNS Zone Contributor on the one DNS zone; Key Vault secrets officer on `kv-geldar-<env>`; staging and test: a separate identity scoped to its own record sets and vault | Azure subscription owner creates once (manual or by the bootstrap app); client id and tenant id are non-secret repo variables | no client secret exists |
| Bootstrap Entra app | `Application.ReadWrite.OwnedBy` only (admin consent once); owner of the Geldar sign-in apps it creates | Azure tenant admin creates once; its federated credential is bound to the `production` and `test` environments | cannot touch apps it does not own. **Unverified** that `OwnedBy` covers redirect-URI edits: spike G0-01 |
| Entra sign-in app per environment | redirect URI of that environment; one client secret | created and rotated by the stamp (`credential reset --append`, then delete the old key); secret goes straight to the vault and the host file, never printed | secret expiry tracked; rotation is its own recorded run |
| Key Vault per environment | holds only secrets that must outlive a host (Entra client secret, backup key) | created by the Azure bootstrap | host-generated secrets are not copied here (D-GN-04) |
| node 3 Hyper-V SSH key | create and manage VMs on node 3 | **operator machine only** (owner's desktop); never in CI | G3-04 runs from the operator machine or a dedicated runner on node 3 |
| Backup destination credential | write-only to the off-node backup location; restore uses a separate read credential | decision open (location); the write credential is the only one on the host | G5-01 names it |
| GitHub token for the workflow | `contents: read`, `packages: read`, `id-token: write`; nothing broader | the workflow's own `GITHUB_TOKEN` | pinned actions by commit SHA |
| Registry pull | GHCR pull of public images | none needed for public packages | private packages need a read token |
| Things the workflow never holds | subscription logins, deploy keys of player repos, the gateway (UniFi) credentials, the live node's `nats-auth.conf` passwords | humans and scriptorium | checked as prerequisites |

## 7. Kit-facing contract (D-GN-06)

Genesis provides, for each environment: the public MCP URL, the register and Glass URLs, a documented way to mint a world token and add a roster entry through `colo-admin.sh` verbs (or the owner API), and a stable health endpoint. scriptorium's fleet campaign consumes it to start ranger hosts. The final acceptance (a real ranger connected) is a human step recorded in G7-03.

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| A stamp touches the live node | Production is never stamped in place; plan mode is read-only; the environment definition names the host; apply refuses an environment whose host fingerprint does not match |
| Regenerating NATS or secrets drops users or breaks Postgres volumes | create-if-missing; NATS users generated on the target; adopt mode for an existing node; a test proves a second apply changes nothing |
| `file:` secrets ignore `uid` and `mode` in Compose | G2-01 tests ownership and mode of every mounted secret in the container; entrypoint or env-sourced secrets where needed |
| Entra automation over-privileged | `OwnedBy` only, spike G0-01, per-environment identity |
| Hosted runner cannot fit Paper plus stack | G0-02 measures first; the ephemeral stamp falls back to services-only plus a Paper image smoke if needed |
| World not reproducible | the seed reproduces terrain only for a fixed Paper build; player builds and generated chunks are not; backups are the only recovery for those (documented in G5-02) |
| Runner or deploy key compromise | forced command, per-environment key, dispatch-only, protected environments, no PR-triggered stamp |
| Unattended restarts of live players | none: restarts need the owner's window; test environments are separate |

## 9. Exit run

On a clean Debian VM on node 3 (created by G3-04): dispatch `stamp.yml` for the test environment with `apply`; it reaches `verify` green; dispatch again and `plan` reports no drift; run the restore drill; destroy and re-create the VM and stamp again from backups; the owner connects a real ranger to it. Production is described by `envs/colo.yaml` and the drift report against the live node is empty or accepted. This is the campaign's exit, not the merge of the packets.

## 10. Sources

Interviews (2026-11-14): geldar-93, geldar-ops, geldar-registration, scriptorium-orchestrator. Repo reads: `compose/colo.yml`, `compose/phase0.yml`, `deploy/*`, `.github/workflows/ci.yml`, `colo-images.yml`, `colo-deploy.yml`, `geldar.ps1`, `docs/runbooks/colo-deploy.md`. Online (accessed 2026-11-14): GitHub Docs on self-hosted runners, secure use, environments, concurrency, hosted runner specs, OIDC subject claims and immutable subjects; Docker Docs on `depends_on` conditions, `compose up --wait` and the services secrets reference; PostgreSQL `pg_dump`; pgBackRest; SOPS; NATS JetStream backup and restore, resolvers and config reloading; Microsoft Learn on workload identity federation, Graph permissions, `az ad app credential reset` and Azure DNS protection. Several fetches failed and are marked unverified in the research notes; each unverified point has a spike.
