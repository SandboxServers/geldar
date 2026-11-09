# 0005. Exact pins, two-week minimum age, Dependabot security updates only

- Status: Accepted
- Date: 2026-11-08
- Spec: section 5.1 (pin the whole tested combination), section 8.7 (supply chain)

## Decision

- Every dependency is pinned to an exact version: npm packages (`saveExact: true` in `pnpm-workspace.yaml`), pnpm itself (`packageManager`), Node (`.nvmrc`), Gradle dependencies and plugins, Docker images by digest, GitHub Actions by commit SHA with the tag in a comment, the Paper build, and Ollama model tags.
- A new pin uses a release at least two weeks old, so a compromised or broken release has time to be noticed and pulled.
- Dependabot opens **security** update PRs only. Version-update PRs are switched off (`open-pull-requests-limit: 0` in `.github/dependabot.yml`). Upgrades are deliberate PRs that re-run the body benchmark.

## Why

The spec requires pinning the whole tested combination (Paper, Java, Mineflayer, protocol libraries, plugins) because protocol support alone doesn't prove digging, combat or eating work. A routine bump can silently change body behavior and invalidate benchmark and research comparisons.

## Consequences

- An upgrade PR names what it upgrades and why, and reruns `./geldar.ps1 bench` when it touches the body stack.
- When a packet adds a new ecosystem (Gradle in `plugin/`, Docker images in `compose/`), it adds a matching security-only entry to `.github/dependabot.yml`.
