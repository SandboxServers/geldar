# 0083. Body and Mind image contents, base pins, and what is never baked in

- Status: Proposed
- Date: 2026-11-10
- Spec: section 6.1 (the Mind on the colo's Record/Mind host), section 6.3, section 13; decisions 0005 (exact pins, two-week minimum age), 0078 (Mind placement for Phase 1), 0081 (first-party exemption and the digest pin), 0130 (owner rulings for C1). Packet P1-C1-03.

## Decision

1. **Two images, built from the repository.**
   - `golem/Dockerfile` builds the Body for Adam: the entry point is `golem/src/adam/main.ts`. It installs the `@geldar/golem` workspace package and its workspace dependency `@geldar/contract` with production dependencies only.
   - `animus/Dockerfile.mind` builds the Mind for Adam-class agents on the Record/Mind host (0078): the entry point is `animus/src/main.ts`. It installs `@geldar/animus` and `@geldar/contract` the same way.
   - Both build from the repository root, with an allowlist ignore file next to each Dockerfile (`Dockerfile.dockerignore`), so only the packages above enter the build context.
   - Image names: `geldar-body` and `geldar-mind`. Both fall under the first-party prefix `ghcr.io/sandboxservers/geldar-` (0081), so they need a digest pin and no release date.

2. **Base image.** Both use the Node base the repository already pins, `node:22.23.2-trixie-slim`, by digest (`sha256:c5849ff9...`). The digest was published 2026-09-19, past the 14-day floor. It is the same digest `threshold/mcp` uses, so the release-date record already exists. The final stage copies only `/opt/geldar` from the install stage, so the pnpm store and the install cache stay out of the final image.

3. **Reproducible install.** Both images run `pnpm install --frozen-lockfile --prod` with the filter for their package. pnpm comes from corepack, which checks the `packageManager` hash in the root `package.json`.

4. **Runs as a non-root user.** The final stage runs as `1000:1000`. Each image sets `NODE_ENV=production` and no other environment value.

5. **Never baked in.** No image contains:
   - a credential, token or password, in an `ARG`, an `ENV` or a layer. A name that matches `PASSWORD`, `TOKEN` or `SECRET` may appear only as a `*_FILE` path set at run time (for example `GELDAR_NATS_PASSWORD_FILE`, as in `compose/nats-auth.yml`);
   - `compose/secrets`, `.env` files, test files, or `node_modules` from the host (the ignore files exclude them);
   - an endpoint or address that differs per shard. The shard file is read from `/opt/geldar/shards`, mounted at run time. The Mind's model endpoint (the Thinker gateway) is run-time configuration.

6. **Smoke.** Each image starts with no configuration and exits 1 with one JSON line naming the missing file (`ENOENT ... shards/phase0.yaml`), not a stack trace. Neither image opens a listening port, and neither is connected to a live shard by this record.

7. **Not in this record.** Compose wiring (C1-02), the image digest in the deploy packet (C1-04), the GHCR publish workflow, and any push of an image. The images are built locally and not pushed.

## Consequences

- The Body and the Mind each have a test that reads the Dockerfile and its ignore file as text (`golem/src/image.test.ts`, `animus/src/image.test.ts`). Changing a pin to a tag, or adding a credential `ENV`, fails the test.
- The NATS password file check is not yet in the Body's configuration code. Until the NATS auth packet (C1-06a) adds it, a run without a password file does not fail on that file; it fails on the missing shard file first.
- A new base image digest needs its release date in `tools/repo-checks/src/release-dates.json` before the image is changed.
