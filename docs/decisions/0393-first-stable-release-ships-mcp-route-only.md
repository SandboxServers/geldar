# 0393. The first stable release ships the MCP route only

- Status: Accepted (owner)
- Date: 2026-11-21
- Spec: section 13 (release scope); 0134 and 0212 (animus and golem-body stay off); HC-08c and HC-09 (harness work)
- Related: 0392 (held-live exception), 0391 (operator rulings of 2026-11-20)

## Decision

1. The first stable release offers the MCP route only, for the Claude and ChatGPT harnesses.
2. The local route (geldar-local) stays shipped but is not offered. The launcher keeps refusing `--cli local` with `local_unavailable`. HC-08c and HC-09 go in the next version.
3. animus and golem-body stay off, as 0134 and 0212 say.
4. Release tags:
   - `geldar-v0.1.0`: a new tag namespace. The repo has only `psyche-v*` tags today.
   - `kit-v0.1.0`.
5. Tags are made by Sam by hand, and no bot tags anything:
   - `kit-v0.1.0-rc23` at the release-check step.
   - The stable pair (`geldar-v0.1.0` and `kit-v0.1.0`) after the 24-hour report (0392, step 8).

## Why

Sam's ruling of 2026-11-21. The MCP route is the one the harnesses already use. The local route is shipped code that the launcher does not yet offer, and HC-08c and HC-09 are its missing parts. Hand tagging keeps the release decision with the owner.

## Consequences

- The release notes and the launcher's offered routes describe MCP only.
- The local route's `--cli local` refusal is a release fact, not a bug, until HC-08c and HC-09 land.
- Tag creation is a manual step in the release runbook; no workflow may create `geldar-v*` or `kit-v*` tags.
