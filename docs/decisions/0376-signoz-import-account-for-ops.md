# 0376. A limited SigNoz login for ops imports

- Status: Proposed (the owner creates the login and accepts or edits this record)
- Date: 2026-11-17
- Spec: section 7 (monitoring). Builds on 0350 and 0374. Runbook steps: [nf-live-telemetry.md](../analysis/telemetry/nf-live-telemetry.md), "SigNoz import".

## Context

The NeoForge and Paper dashboards and alert rules are JSON files in `deploy/signoz/`. They reach SigNoz only by an import in the SigNoz UI or through its API, which needs a login.

## Decision

1. The owner creates one limited SigNoz login, used by ops for dashboard and alert imports only.
2. The login, its password and any API token never appear in the repo, in a chat, in a report or in a log. Ops keeps them in their own secret store and passes a token from the shell at call time.
3. Imports are done by name with the files in `deploy/signoz/`; rollback is deleting the imported objects.
4. No agent holds the login, and no service reads it.

## Why

An import is a write to the monitoring system, so it needs an identity, and a limited one keeps its reach small.

## Consequences

- Ops needs the owner before the first import.
- The role name and exact permissions of the login are not set here.

## Not settled by this record

- The SigNoz role, and whether the API token form is used instead of a session login (UNVERIFIED for v0.148.1).
