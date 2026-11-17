# 0373. @geldar/telemetry is distributed as a GitHub Release tarball

- Status: Accepted (owner ruling relayed by the orchestrator, geldar-93, 2026-11-17)
- Date: 2026-11-17
- Spec: section 7 (monitoring). Builds on 0350 and 0352 (telemetry design); changes only how the package reaches a consumer outside this repo.

## Context

`@geldar/telemetry` was a private workspace package that exports TypeScript source (`./src/index.ts`). The kit repo `geldar-scriptorium` is a separate repo and needs the package. Node 22 refuses to strip types under `node_modules`, so the kit needs built JavaScript. The kit uses pnpm 12.15.0 with a frozen lockfile.

## Decision

1. **Distribution.** The package is released as a tarball attached to a GitHub Release, built by `.github/workflows/telemetry-release.yml` on a push of a tag `telemetry-vX.Y.Z`. The workflow holds `contents: write` and uses `GITHUB_TOKEN` only. It never publishes to a registry. This repo is public, so the kit downloads the asset without a token.
2. **Built JS only.** The tarball holds `dist/` (ESM, `.js` and `.d.ts`), `package.json`, `README.md` and `LICENSE`. In the workspace, `exports` still points at `./src/index.ts`, so workspace consumers and vitest are unchanged. `publishConfig` overrides `exports`, `main` and `types` to `dist`; pnpm applies it at pack time. Dependencies are exact `@opentelemetry/*` versions and ordinary `dependencies` of the tarball.
3. **Versioning.** The tag `telemetry-vX.Y.Z` must equal `telemetry/package.json` version `X.Y.Z`; the workflow fails otherwise.
4. **Immutability.** The workflow never overwrites a release: it fails if a release for the tag already exists, and creates the release without `--clobber` or any later upload. It does not stop a person with write access from uploading or replacing an asset by hand. The real control is a repository tag ruleset on `telemetry-v*` (restrict create, update and delete to maintainers). That is an owner action and is not done here; it is a follow-up for geldar-93. Until then, the consumer's lockfile integrity rejects a replaced asset. A change is a new version and a new tag.
5. **Consumer pin.** The kit declares the release URL as the dependency and pins the content hash in its pnpm lockfile (lines below).
6. **The 14-day rule (0005).** This repo's release-age and pin rules apply to third-party npm packages in this repo's own manifests and lockfile. This repo does not consume the tarball, so `release-age.ts` needs no change. The kit has no release-age script (its orchestrator says so). If the kit adds one, a first-party allow entry for this tarball is a one-line change there; the integrity must still be required.
7. **No accidental publish.** `private` is dropped from `telemetry/package.json`. There is no changeset setup, and no workflow today runs a `publish` command: the release workflow creates a GitHub Release with `gh release create`. The repo test below checks that rule for `telemetry-release.yml` only, not for other workflows. A repo test (`tools/repo-checks/src/telemetry-release-workflow.test.ts`) fails if the trigger widens to branches, permissions grow, a secret other than `GITHUB_TOKEN` appears, or a registry publish command is added.

## Alternatives considered

- **GitHub Packages (npm registry).** Needs a read token even for public packages, and the package scope must match the owner (`@sandboxservers`, not `@geldar`), which would rename the package. Rejected.
- **Public npmjs.** Publishes first-party code to a public registry, needs a publish secret, and the 14-day floor, name ownership and unpublish rules become ours to run. Rejected for now.
- **Vendoring the source into the kit with a drift test.** Two copies and a cross-repo test; source TypeScript would not run under `node_modules` without a build. Rejected.

## Consequences

- A new release needs a new version and a new URL, so the kit must regenerate its lockfile line each time.
- The packed `package.json` keeps the `build`, `typecheck` and `test` scripts; they are inert for a consumer.
- Tampered bytes fail the integrity check in pnpm, but slowly, because pnpm retries with back-off before it fails.
- Releases hang on the tag, not on a branch. The workflow fails unless the tagged commit is an ancestor of `origin/main` (`git merge-base --is-ancestor`, full-history checkout). This stops a mistaken tag, not a writer who edits the workflow in the tagged commit, because the workflow file comes from that commit. The tag ruleset in item 4 is the control for that case.
- The release build installs from the frozen lockfile with no pnpm store cache, and the checkout does not persist the token. The release is created with `--latest=false`.

## How to cut a release

1. Bump `version` in `telemetry/package.json` and merge it to `main`.
2. `git tag telemetry-vX.Y.Z <merged commit>` and `git push origin telemetry-vX.Y.Z`.
3. The workflow checks that the commit is on `main`, the tag against the version, and that no release exists, then installs, runs typecheck and tests, builds, packs, and creates the release with `geldar-telemetry-X.Y.Z.tgz` and `SHA256SUMS`. The notes carry the install URL, the sha512 integrity string and the sha256.
4. The kit sets the dependency to the URL and runs `pnpm install` (with pnpm 12.15.0), then commits the changed lockfile.

Recovery:

- A run that failed before `gh release create` left no release: fix the cause and re-run the job, or delete the tag and push it again.
- A bad release (wrong content, or a failed upload that left a draft; `gh release view` does not find drafts): the owner deletes the release and its tag (`gh release delete telemetry-vX.Y.Z --cleanup-tag`), bumps `version`, merges, and tags the new version. Never reuse a version that a consumer may have pinned.
- This repo does not consume the tarball; the owner's first-party release-age exemption stands if that changes.

Dependency spec in the kit's `package.json`:

```json
"@geldar/telemetry": "https://github.com/SandboxServers/geldar/releases/download/telemetry-v0.1.0/geldar-telemetry-0.1.0.tgz"
```

Lockfile forms pnpm 12.15.0 writes (verified on a local server with the same shape; the `integrity` is the sha512 of the tarball bytes):

```yaml
importers:
  packages/app:
    dependencies:
      '@geldar/telemetry':
        specifier: https://github.com/SandboxServers/geldar/releases/download/telemetry-v0.1.0/geldar-telemetry-0.1.0.tgz
        version: https://github.com/SandboxServers/geldar/releases/download/telemetry-v0.1.0/geldar-telemetry-0.1.0.tgz

packages:
  '@geldar/telemetry@https://github.com/SandboxServers/geldar/releases/download/telemetry-v0.1.0/geldar-telemetry-0.1.0.tgz':
    resolution: {integrity: sha512-<base64>, tarball: https://github.com/SandboxServers/geldar/releases/download/telemetry-v0.1.0/geldar-telemetry-0.1.0.tgz}
    version: 0.1.0
```

`pnpm install --frozen-lockfile` fails with `ERR_PNPM_OUTDATED_LOCKFILE` when the URL in `package.json` and the lockfile differ.
