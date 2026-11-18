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

**Apply order** (each step idempotent and re-runnable, and **each phase ends at an explicit gate**; reviewed by geldar-ops): host bootstrap (Docker `default-address-pools` set) → pre-pull images by digest after the disk precheck → images and config bundle → release manifest written **before any host starts** → secrets (create-if-missing) → NATS config and users generated on the target; gate: users and KV buckets exist → Postgres up, roles, migrations (dump first); gate: schema at head → Paper first start; gate: RCON answers → plugins (jars by digest) and Velocity; gate: the Velocity identity plugin is loaded → edge (Caddy snippet, DNS) → services (eventsink, MCP, register, Glass); gate: MCP has created the presence bucket → seed (roster, owners) from operator inputs → **Body hosts last** → verify. Body hosts start only after the gates, because `players/main.ts` exits 1 on any startup error (a missing presence bucket included), which under `unless-stopped` (decision 0342) becomes a crash loop with no restart cap, and `--no-deps` skips compose `depends_on`; geldar-ops queues a Golem retry-with-backoff item of their own. The environment definition also supplies `GELDAR_COLO_ROOT`, `GELDAR_RELEASE_FILE`, `GELDAR_COLO_SHARD`, `HOST_MANIFEST` and the subnet and project name (today `192.0.2.0/24` and `geldar-colo`) as parameters.

**Artifacts, not hand copies.** CI builds the two plugin jars and a **config bundle** (compose files, shard files, plugin configs, Caddy snippets, deploy scripts) and publishes them with a digest into the release manifest. The target pulls by digest. Third-party jars keep the lock-file path, with sha512 checked as well.

**State and recovery.** Scheduled `pg_dump` (custom format) and a JetStream stream backup to an off-node location, a world archive, retention, and a **restore drill** in CI that restores into an ephemeral container and runs the schema checks. A stamp has a `restore` mode that stamps and then restores the backups.

**Deploy channel.** A GitHub-hosted job reaches the target over SSH with a key whose `authorized_keys` entry forces one wrapper command (no shell), per environment. The existing self-hosted runner path stays for the live node until cutover (the node stays on its window process). Research recommends against self-hosted runners that share a host with production for PR-triggered work; the stamp workflow is dispatch-only.

**Ephemeral CI stamp.** On a hosted runner (4 vCPU, 16 GB for a public repo; the repo is public) run Postgres, NATS, the services, a reduced Paper (small world, low memory) behind Velocity, and the scripted test player. **G0-02 is measured** (reduced profile only, [g0-02-runner-spike.md](g0-02-runner-spike.md)). With three Body hosts the compose limits sum to about 21 GB, which does not fit a 16 GB runner, so the spike measured Postgres, NATS and Paper (2.5 GB limit, real geldar-core jar, empty world) on the hosted runner (4 vCPU, 15983 MB RAM, 145G disk). Result: Paper "Done" at 50 s, peak host memory 3620 MB (limit 12288 MB), disk growth 2143 MB (limit 14336 MB), so the boot fits with large headroom. **Not measured**: Velocity, the services, Body hosts at 768 MB, plugin sets, a pre-generated world, and image pull time. The ephemeral stamp therefore stays a full-stack target pending a second measurement with Velocity, the services and 3 Body hosts at 768 MB, which G6-04 must record. Disk (about 14 GB) remains the tighter limit when the full stack is added.

## 4. Test environment on node 3

The owner wants a Hyper-V Debian VM on node 3 as the first non-production stamp, built from a fresh install with no dependencies pre-installed, ending with bodies connected and a real ranger on the test world. Plan: G3-04 creates the VM (PowerShell over SSH from an operator machine that holds the node 3 key; CI does not hold it; it reuses scriptorium's parameterised `New-HostVm.ps1` rather than a second script, see the card); G3-01 bootstraps from bare Debian; G4 stamps it; G6 verifies it with the scripted test player; the owner then points a real ranger at it as acceptance (human step, scriptorium side).

## 5. Principles

Idempotent everywhere (create-if-missing, upsert, no silent rotation); plan before apply; no secret in the repo, an input, a log or a summary (mask, pipe, never echo); least privilege per environment; every apply is a recorded run with the commit and the definition hash; the live node is never rebuilt in place.

## 6. Credentials the workflow holds, scopes and holders (names only, nothing in the repo)

| Credential | Scope | Holder and where it lives | Notes |
|---|---|---|---|
| GitHub Environment `<name>` (one per environment) | protects the stamp job; required reviewer; branch restriction | repo owner (GitHub settings, manual once) | defines which environment can use which identity |
| Deploy SSH key per environment | forced command on the target's `authorized_keys`, one wrapper | private key in the GitHub Environment secret; public key installed by bootstrap | key cannot give a shell; rotate by re-running bootstrap |
| Azure OIDC identity per environment (workload identity, federated credential, subject `environment:<name>`, plus repository id) | production: DNS Zone Contributor on the one DNS zone; Key Vault secrets officer on `kv-geldar-<env>`; staging and test: a separate identity scoped to its own record sets and vault | Azure subscription owner creates once (manual or by the bootstrap app); client id and tenant id are non-secret repo variables | no client secret exists |
| Bootstrap Entra app | `Application.ReadWrite.OwnedBy` only (admin consent once); owner of the Geldar sign-in apps it creates | Azure tenant admin creates once; its federated credential is bound to the `production` and `test` environments | cannot touch apps it does not own. Owner-confirmed that `OwnedBy` covers app updates (2026-11-14); federated-identity use verified at the first G2-05 run |
| Entra sign-in app per environment | redirect URI of that environment; one client secret | created and rotated by the stamp (`credential reset --append`, then delete the old key); secret goes straight to the vault and the host file, never printed | secret expiry tracked; rotation is its own recorded run |
| Key Vault per environment | holds only secrets that must outlive a host (Entra client secret, backup key) | created by the Azure bootstrap | host-generated secrets are not copied here (D-GN-04) |
| node 3 Hyper-V SSH key | create and manage VMs on node 3 | **operator machine only** (owner's desktop); never in CI | G3-04 runs from the operator machine or a dedicated runner on node 3 |
| Backup destination credential | write-only to the off-node backup location; restore uses a separate read credential | decision open (location); the write credential is the only one on the host | G5-01 names it |
| GitHub token for the workflow | `contents: read`, `packages: read`, `id-token: write`; nothing broader | the workflow's own `GITHUB_TOKEN` | pinned actions by commit SHA |
| Registry pull | GHCR pull of public images | none needed for public packages | private packages need a read token |
| Things the workflow never holds | subscription logins, deploy keys of player repos, the gateway (UniFi) credentials, the live node's `nats-auth.conf` passwords | humans and scriptorium | checked as prerequisites |

## 7. Kit-facing contract (D-GN-06)

Genesis provides, for each environment, to scriptorium's fleet campaign (reviewed by scriptorium-orchestrator, 2026-11-14):

1. **URLs.** The public MCP URL shape `https://<host>/p/<player id>` (the launcher writes it into each player's `mcp_url`), plus the register and Glass URLs. The kit's egress proxy allows only that hostname on port 443, so a test environment needs a **real hostname** (DNS from G2-06), not a bare address, or an explicit allow entry on the kit side. The environment definition states which of the two the test environment uses.
2. **Reachability.** The environment definition states which source networks its MCP endpoint accepts. The node 3 ranger host could not reach the production public MCP address until a gateway policy was added, so the stamp's verify step checks reachability from the declared source network over TCP and also checks that network's DNS answer for the host (split DNS), and the gateway rule stays a checked prerequisite.
3. **Mint and roster verbs.** The exact `colo-admin.sh` verbs (or owner API calls) to add a roster entry and mint a world token, with the **token returned as a file path or on stdin, never in a workflow log**. The mint token file is mode 0600, readable only by the launcher user on the player host, and reaches the host by operator copy, never through the runner. A test ranger uses a **test id**, never a production ranger's id.
4. **Health endpoint** that needs no token.
5. **Optional skin** for the test id (signed skin JSON and PNG), placed by an operator step.
6. **Kit identity fields.** The kit also needs the player id, the display name and a skin (the skin only if the environment has a skin step).

The final acceptance (a real ranger connected) is a human step recorded in G7-02 and G6-05; the subscription login is the owner's on scriptorium's side.

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| A stamp touches the live node | Production is never stamped in place; plan mode is read-only; the environment definition names the host; apply refuses an environment whose host fingerprint does not match |
| Regenerating NATS or secrets drops users or breaks Postgres volumes | create-if-missing; NATS users generated on the target; adopt mode for an existing node; a test proves a second apply changes nothing |
| `file:` secrets ignore `uid` and `mode` in Compose | G2-01 tests ownership and mode of every mounted secret in the container; entrypoint or env-sourced secrets where needed |
| Entra automation over-privileged | `OwnedBy` only (owner ruling 2026-11-14: it covers app updates on apps the bootstrap app created), per-environment identity |
| Hosted runner cannot fit Paper plus stack | G0-02 measured the reduced boot (g0-02-runner-spike.md); the full stack is measured in G6-04; the ephemeral stamp falls back to services-only plus a Paper image smoke if needed |
| World not reproducible | the seed reproduces terrain only for a fixed Paper build; player builds and generated chunks are not; backups are the only recovery for those (documented in G5-02) |
| Runner or deploy key compromise | forced command, per-environment key, dispatch-only, protected environments, no PR-triggered stamp |
| An admin verb run by hand through `colo-admin.sh` used `docker compose run`, which stopped Postgres and detached it from its network (repaired with `docker network connect --alias postgres`) when the environment was not exactly the node's (`colo-env.sh`, `node.env`, uid 1001, the service-uid check) | The stamp treats every admin verb as a **non-disruptive one-shot**: a test starts a one-shot with `--no-deps` and asserts no other container is stopped, recreated or detached, and refuses to run when the environment file does not match the definition (G4-04, G6-01) |
| Unattended restarts of live players | none: restarts need the owner's window; test environments are separate |
| Plugin jars are built on a trusted machine and copied by hand; the live Paper compose file on the node was found stale for days (it lacked the CoreProtect mount); the BlueMap heads folder was filled by hand; `plugin-jars.sha256` on the node was stale | CI builds the jars and publishes their digests (G1-01) and the config bundle is one digest-pinned archive (G1-03); the plan-mode drift check (G7-01) compares the compose hash and the jar digests against the definition and reports every difference |
| The colo deploy applies only images, migrations (after a `pg_dump`) and the Body hosts; Paper, Velocity, Caddy, NATS config, compose changes and plugin jars are "needs manual" | The stamp is the only automated path for these, and production is never stamped in place; production changes still go through geldar-93's window |
| The world has no tested backup or restore; only pre-migration Postgres dumps exist | G5-02 (world and JetStream backups), G5-03 (restore drill in CI), G5-04 (`restore` mode) |
| Known non-reproducible items: the gateway firewall policy inserted by hand (VM to Colo); the MineSkin signed skin JSON per agent; the kino-skins PNGs; the Glass alias file; the CoreProtect config set by hand; the gamerule `players_sleeping_percentage` set by rcon (PR #368 adds it to the startup commands); whitelist and roster by operator verbs | Listed as checked prerequisites or operator inputs in each environment definition (G0-04), not as silent manual steps |

## 9. Exit run

On a clean Debian VM on node 3 (created by G3-04): dispatch `stamp.yml` for the test environment with `apply`; it reaches `verify` green; dispatch again and `plan` reports no drift; run the restore drill; destroy and re-create the VM and stamp again from backups; the owner connects a real ranger to it. Production is described by `envs/colo.yaml` and the drift report against the live node is empty or accepted. This is the campaign's exit, not the merge of the packets.

## 10. Sources

Interviews (2026-11-14): geldar-93, geldar-ops, geldar-registration, scriptorium-orchestrator. Repo reads: `compose/colo.yml`, `compose/phase0.yml`, `deploy/*`, `.github/workflows/ci.yml`, `colo-images.yml`, `colo-deploy.yml`, `geldar.ps1`, `docs/runbooks/colo-deploy.md`. Online (accessed 2026-11-14): GitHub Docs on self-hosted runners, secure use, environments, concurrency, hosted runner specs, OIDC subject claims and immutable subjects; Docker Docs on `depends_on` conditions, `compose up --wait` and the services secrets reference; PostgreSQL `pg_dump`; pgBackRest; SOPS; NATS JetStream backup and restore, resolvers and config reloading; Microsoft Learn on workload identity federation, Graph permissions, `az ad app credential reset` and Azure DNS protection. Several fetches failed and are marked unverified in the research notes; each unverified point has a spike.
