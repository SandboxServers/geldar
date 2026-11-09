# 0003. `geldar.ps1` is the task runner, not `make`

- Status: Accepted
- Date: 2026-11-08
- Spec: section 11 (runbook commands)

## Decision

The repo's task runner is `geldar.ps1` at the root, a PowerShell 7 script. The spec's `make shard SHARD=baseline up` becomes `./geldar.ps1 shard up baseline`. It also runs every CI check locally (`./geldar.ps1 check`) and the body benchmark (`./geldar.ps1 bench`).

## Why

`make` isn't native on Windows, the main dev platform. PowerShell 7 is already installed there and on GitHub's Linux runners, so the script runs in both places with no new tool. `just` was the alternative; it is nicer to read but would be one more thing to install on every machine and runner.

## Consequences

- Runbook commands in the spec map one to one onto `geldar.ps1` subcommands; add a subcommand rather than a second script.
- The later `geldar` CLI in the spec (agent spawn, thinker invite, ghost add) is a separate product, not this script.
