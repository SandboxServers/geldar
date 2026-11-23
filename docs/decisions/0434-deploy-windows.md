# 0434. Deploy windows

- Status: Proposed (co-owner)
- Date: 2026-11-23
- Spec: no spec section; decision-only. Related: 0392 (held-live exception), 0433

## Decision

1. A merge that touches a deploy path is booked with the release owner (the co-owner) before it merges.
2. From a release's T0 until its 24h report merges, no deploy-path merge, except a revert or the kill switch.
3. Bundles merge back to back through the merge queue, so they restart the Bodies at most twice.

## Why

Each deploy-path merge runs colo-deploy and restarts the Bodies. A release is measured from a quiet start, and a merge in the middle of the window ruins the comparison.

## Consequences

- The deploy-path list is the one in `.github/workflows/colo-images.yml`; docs and `deploy/` only changes do not deploy and need no booking.
- If a release has no 24h window (the owner may waive it), item 2 applies from T0 to the date the release's report or health check is merged.
