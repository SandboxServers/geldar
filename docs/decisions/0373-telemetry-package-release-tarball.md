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
4. **Immutability.** The workflow fails if a release for the tag already exists, and creates the release without `--clobber` or any later upload, so assets are never overwritten. A change is a new version and a new tag. The consumer's lockfile integrity would reject a replaced asset anyway.
5. **Consumer pin.** The kit declares the release URL as the dependency and pins the content hash in its pnpm lockfile (lines below).
6. **The 14-day rule (0005).** This repo's release-age and pin rules apply to third-party npm packages in this repo's own manifests and lockfile. This repo does not consume the tarball, so `release-age.ts` needs no change. The kit has no release-age script (its orchestrator says so). If the kit adds one, a first-party allow entry for this tarball is a one-line change there; the integrity must still be required.
7. **No accidental publish.** `private` is dropped from `telemetry/package.json`. There is no changeset setup and no `publish` command in any workflow: the release workflow creates a GitHub Release with `gh release create`, and no workflow runs `pnpm publish`. A repo test (`tools/repo-checks/src/telemetry-release-workflow.test.ts`) fails if the trigger widens to branches, permissions grow, a secret other than `GITHUB_TOKEN` appears, or a registry publish command is added.

## Alternatives considered

- **GitHub Packages (npm registry).** Needs a read token even for public packages, and the package scope must match the owner (`@sandboxservers`, not `@geldar`), which would rename the package. Rejected.
- **Public npmjs.** Publishes first-party code to a public registry, needs a publish secret, and the 14-day floor, name ownership and unpublish rules become ours to run. Rejected for now.
- **Vendoring the source into the kit with a drift test.** Two copies and a cross-repo test; source TypeScript would not run under `node_modules` without a build. Rejected.

## Consequences

- A new release needs a new version and a new URL, so the kit must regenerate its lockfile line each time.
- The packed `package.json` keeps the `build`, `typecheck` and `test` scripts; they are inert for a consumer.
- Tampered bytes fail the integrity check in pnpm, but slowly, because pnpm retries with back-off before it fails.
- Releases hang on the tag, not on a branch: the workflow does not check that the tagged commit is on `main`. Tag only merged commits.

## How to cut a release

1. Bump `version` in `telemetry/package.json` and merge it to `main`.
2. `git tag telemetry-vX.Y.Z <merged commit>` and `git push origin telemetry-vX.Y.Z`.
3. The workflow checks the tag against the version and that no release exists, then runs typecheck and tests, builds, packs, and creates the release with `geldar-telemetry-X.Y.Z.tgz` and `SHA256SUMS`. The notes carry the install URL, the sha512 integrity string and the sha256.
4. The kit sets the dependency to the URL and runs `pnpm install` (with pnpm 12.15.0), then commits the changed lockfile.

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
