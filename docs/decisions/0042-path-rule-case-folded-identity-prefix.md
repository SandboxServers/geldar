# 0042. The session path rule never allows `memory/identity.md/` as a prefix, case-folded

- Status: Accepted (filed by the orchestrator at the request of the Scriptorium orchestrator, 2026-11-09; the spec text itself is the owner's to amend)
- Date: 2026-11-09
- Spec: section 7 (the sovereign-player session path rule); implemented in the Scriptorium repo (`packages/path-rule`, launcher `recheck.sh` and `recheck.ps1`)

## Decision

The path rule rejects, in every mode, any path whose ASCII-lowercased form starts with `memory/identity.md/`. Before, only the whole path `memory/identity.md` (any case) was locked.

## Why

On a case-insensitive host (Windows, macOS default) a session commit adding `memory/Identity.md/x.md` passed the rule. The host `merge --ff-only` then turned the working-tree file `memory/identity.md` into a directory, deleting the locked identity file; the launcher reported the session saved, the commit was already on origin, and the next launch was refused as dirty. Found by the Scriptorium Wave 5 security review.

## Consequences

- No previously valid path is affected: `identity.md` is a file, so nothing could legally live under it.
- Spec section 7 should be amended to state the prefix rule. The spec is the owner's; this record does not edit it.
- Open, undecided: also rejecting any added path whose case-folded form collides with an existing start-tree path (or a directory prefix of one) needs the start tree, so it belongs in the host re-check and the gate, not in the pure path rule. Left for a decision in the Scriptorium repo.
