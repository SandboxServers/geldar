# 0133: Colo administration runs in a one-shot container

Status: Accepted (orchestrator, 2026-11-10)

## Context

The colo node runs Linux with Docker and no Node, pnpm or PowerShell. An admin must still apply the SQL migrations,
set the `geldar_mcp` role password, add an owner and a sovereign ranger, and mint a per-player token (C1-11b). Those
commands are the TypeScript CLIs in `tools/migrate` and `tools/mcp-tokens`. Postgres is not published, so the commands
must run inside the compose network.

## Decision

Option A: a small first-party image, `geldar-admin`, built from `tools/admin/Dockerfile`. It holds `tools/migrate`,
`tools/mcp-tokens` and their workspace closure, plus `sql/`. It runs as uid 1000, with the base image pinned by digest
like the other Dockerfiles, and installs with `pnpm install --frozen-lockfile --prod --ignore-scripts`. Its entrypoint,
`tools/admin/admin.sh`, dispatches one subcommand per run to the existing CLI.

The compose service `admin` lives under the profile `admin`. It has no ports and no restart policy, and it is started
only with `run --rm`. It follows every colo compose rule, including the limits and the Watchtower label. The
deploy script runs it inside the project `geldar-colo`.

Each CLI runs under Node's built-in TypeScript type stripping, as the MCP and Body images do (`node src/cli.ts`). No
transpile step is added.

## Why not the alternatives

- Option B, running the CLIs from a host with Node: the node has no Node, and installing one adds a second toolchain
  on a shared machine.
- Option C, a PowerShell or SQL-only admin path: `mcp-tokens` owns the pepper, the hashes and the caps, and
  reimplementing them in a second place would fork the rules.

## Consequences

- The image carries the Postgres password only as a file mounted at run time. Nothing secret is baked in.
- The image's first publish runs on `main` (the colo-images workflow). Nothing is pushed by this change.
- Postgres roles are still the superuser `geldar` for admin work. Least-privilege admin roles are C2.
