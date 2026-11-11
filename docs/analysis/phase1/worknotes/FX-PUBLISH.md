# FX-PUBLISH: publish the Colo images

Status: the workflow and its static test are committed on `feat/publish-colo-images`. The workflow has not run yet. It runs for the first time on the first push to `main` that touches its paths, or on a manual dispatch.

## Why

`deploy/colo-up.sh` refuses a service that builds on the node, and refuses any `*_IMAGE` value that is not a digest reference (`deploy/common.sh`, `load_release`). Until the first-party images are published and pinned by digest, the Colo stack cannot be deployed from a release manifest. This is the C1-10 blocker.

## What the workflow does

File: `.github/workflows/colo-images.yml`.

- **Triggers.** A push to `main` that changes `golem/**`, `animus/**`, `eventsink/**`, `contract/**`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` or the workflow file. Also `workflow_dispatch`. There is no `pull_request` trigger. Each job also requires `github.repository == 'SandboxServers/geldar'`, so a fork never publishes.
- **Images.** Three jobs (`body`, `mind`, `eventsink`) each build with `docker/build-push-action` and push:
  - Body: `golem/Dockerfile` to `ghcr.io/sandboxservers/geldar-body`
  - Mind: `animus/Dockerfile.mind` to `ghcr.io/sandboxservers/geldar-mind`
  - Eventsink: `eventsink/Dockerfile` to `ghcr.io/sandboxservers/geldar-eventsink`
- **Tags.** Each image gets `:main` and `:<12-character commit>`. Tags are for humans. The deploy pins the digest only.
- **Build context.** The repo root, filtered by each Dockerfile's `.dockerignore` allowlist, so only the workspace manifests, `contract/` and the one image's package are sent. The Eventsink ignore file now also excludes `.env` files.
- **Attestations.** `provenance: false` and `sbom: false`, as in `mcp-mock-image.yml`. Images are unsigned.
- **Permissions.** Top level `contents: read`. Only the three image jobs add `packages: write`. The manifest job has `contents: read` only.
- **Secrets.** Only `GITHUB_TOKEN`, used to log in to ghcr.io.
- **Pins.** Every `uses:` is a 40-hex commit SHA. `actions/checkout`, `docker/setup-buildx-action`, `docker/login-action` and `docker/build-push-action` are the SHAs `ci.yml` and `mcp-mock-image.yml` already use. `actions/upload-artifact` is v7.0.2 (`cf430e030ddbb5b0abf93d22962f4752f3646cd9`, committed 2026-10-07, past the 14-day floor).
- **Release manifest.** The `manifest` job waits for the three images. It checks that each digest from the push step is `sha256:` plus 64 hex, then writes `release.env`:

  ```
  # Release manifest for the Colo node (decision 0084). Commit <40-char sha>.
  GELDAR_BODY_IMAGE=ghcr.io/sandboxservers/geldar-body@sha256:<digest>
  GELDAR_MIND_IMAGE=ghcr.io/sandboxservers/geldar-mind@sha256:<digest>
  GELDAR_EVENTSINK_IMAGE=ghcr.io/sandboxservers/geldar-eventsink@sha256:<digest>
  ```

  The commit is a comment line, because `load_release` refuses any key that is not `*_IMAGE`. The job uploads this file as the artifact `release.env` and writes a table of the same three references to the run's job summary.

The static test is `tools/repo-checks/src/colo-images.test.ts`. It parses the workflow offline and checks the triggers, the SHA pins, the secret names, the permissions, the upstream-repository guard, the three first-party image names against `first-party-images.json`, the Dockerfile for each image, and the `release.env` writer and upload.

## Owner actions

These are not done by the workflow.

1. **Make each package public.** A package created by a workflow is private by default. After the first run on `main`, open each of `geldar-body`, `geldar-mind` and `geldar-eventsink` under the SandboxServers organization's packages. In Package settings, change the visibility to public. The images contain only this public repository's code, so a public package is the simplest way for the node to pull without a registry login. If the package must stay private, the node needs `docker login ghcr.io` with a read-only token instead, and the release manifest does not change.
2. **Link each package to the repository.** In the same Package settings, connect the package to `SandboxServers/geldar`.
3. **Allow the workflow to write packages.** If the organization or repository restricts `GITHUB_TOKEN` to read-only, the image jobs cannot push. Check the repository's Actions workflow permissions.

## First-publish check

After the first run on `main`:

1. Open the run and check that all four jobs passed. The `release.env` table in the job summary shows three references.
2. Download the `release.env` artifact. It must have the commit line and three `GELDAR_*_IMAGE=ghcr.io/sandboxservers/geldar-<name>@sha256:<64 hex>` lines. Any other shape is a bug in the workflow.
3. Confirm each digest resolves from the registry, for example with `docker buildx imagetools inspect` on a machine that can reach ghcr.io. This needs the packages to be public or a read-only login.
4. Copy the artifact to `/etc/geldar-colo/release.env` on the node (root, mode `0600`) as described in `deploy/README.md`, then run the deploy with `deploy/colo-up.sh`. The script refuses a manifest that is not digest-pinned.

## Notes

- Eventsink differs from Body and Mind in one place. It runs `pnpm install` without `--ignore-scripts`, and its base is the Alpine image. Its user is `node`, the base is digest-pinned, and it has no secrets. This is not changed here.
- `deploy/README.md` still says to "fill in digests" for the release manifest. The example comments now say the values come from the artifact. The README wording is a follow-up.
