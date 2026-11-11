# 0084. Colo deploy by pull, with a project-scoped script

- Status: Proposed
- Date: 2026-11-10
- Spec: section 13 (deploy and operations); decisions 0082 (Colo compose layout, loopback ports, never 25565 or 25566), 0083 (Body and Mind images, digest pins), 0130 (owner rulings for C1: deploy by runner or SSH). Packet P1-C1-04.

## Problem

The Colo node is shared. It also runs the production game server and the CI runners, and its Caddy serves other sites.
A deploy that builds images on the node, restarts shared services, removes volumes, or touches containers outside the
Colo project could take those down. The deploy also has to be repeatable and reversible, and it must not put a
secret in the repository.

## Decision

1. **Pull, do not build.** The node pulls the release images by digest and starts them. Nothing is built on the node.
   `deploy/colo-up.sh` runs `docker compose pull`, then `up -d --wait`.
2. **Project-scoped.** Every compose call names the project `geldar-colo` (`-p`), so it reaches only that project's
   containers, networks and volumes. Other containers are not listed or touched. The status script finds containers by
   the compose project label, and it reads ids from the label-filtered list before it asks for stats.
3. **Never `down -v`.** No script removes a volume. `colo-down.sh` stops the project; it keeps containers, networks
   and volumes.
4. **Release manifest by digest.** The release is a root-only file (`/etc/geldar-colo/release.env`, mode 0600) with one
   `*_IMAGE` line per image. Each value must be a digest reference. A tag, a bare name, and `latest` are refused.
   The third-party images are pinned in `compose/colo.yml` and checked from the merged config.
5. **Refusals.** The deploy refuses:
   - a merged config that publishes port 25565 or 25566 (decision 0082);
   - an image in the merged config that is not digest-pinned;
   - a service with a `build:` key and no `image:`, which would be built on the node.
6. **Secret files.** The four secret files must exist, be non-empty, and have mode 0600 or 0400 under a root-only
   directory. The scripts never read a secret file's contents and never print a value. `gen-secrets.sh` never
   overwrites a file.
7. **BlueMap jar.** The jar is fetched from the URL in the lock file, over https only, and its sha256 must match the lock.
   A mismatch stops the deploy and nothing is installed.
8. **Dry run.** `DEPLOY_DRY_RUN=1` runs every read-only check and prints the state-changing steps without running them.
9. **Rollback by record.** Before a deploy changes anything, the previous and current release are written to the state
   directory. Rollback re-applies the recorded previous release with `--pull never`, and swaps the two records. A
   deploy that cannot write its record does not start.
10. **Access.** The deploy runs from the self-hosted runner or over the owner's existing SSH access (decision 0130).
    No new deploy account is created. The target host and user come from environment variables set for the session,
    and they are never committed.

## Consequences

- A deploy can only change the Colo project. A mistake in the script cannot reach the game server, the runners or
  the shared proxy, and a volume cannot be removed by a deploy.
- Every running image is named by digest in the release file, so a deploy is reproducible and the record shows what
  ran before.
- Rolling back the images does not undo data changes. A release that changes the schema needs its own plan before
  rollback.
- The scripts are POSIX `sh`. Their tests run on the desktop through Vitest, and the Linux run is the integration
  owner's job in CI.
- Not covered by this record: generating NATS auth config (PowerShell-only for now), publishing the images to a
  registry, and wiring the NATS auth overlay into the node. Each is a follow-up in the worknote.
