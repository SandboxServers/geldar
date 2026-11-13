# Retro: wave C7-1 (roster, admin flag, supervisor core, token lifecycle)

Merged as bbb5ed6b (PR #315), 2026-11-13. Packets: C3-04s, C7-12, C7-03a (package only), C7-02a (SQL and service only). Plan: [packets/c7-wave-plan.md](../packets/c7-wave-plan.md).

## What happened

- Five review passes. Each pass found real defects: the CI gate (a trigger function with no PUBLIC revoke and no pinned search_path), a supervisor bypass of the per-agent quota, and uncounted bodies on a late start. Fix rounds ran after passes 1 to 4; pass 5 returned ship with two accepted edge cases and one missing unit test (see `wave1-review-5.md`, Carry-forward).
- Eight fix coders and several continuation coders. About half the coders hit their context cap before committing, so the work was split and resumed from WIP commits.
- The plan said C7-02a needed no migration. That was wrong: the lifecycle needed a column, and the orchestrator ruled migration 0032. Only 0033 is spare now.
- The first CI run was red for a reason no local check showed. `psql` could not run on the coder's machine, so the 0011 gate (the append-only trigger function) failed only in CI. A scratch Postgres in Docker gave a fast feedback loop once it was used.
- Twice, coders and an ops agent ran git in the primary checkout by mistake. A merge landed on local main and the orchestrator reset it. No tracked work was lost.
- Migrations 0024, 0025, 0027 and 0032 are applied on the node (deploy run 43522419766; a pre-deploy pg dump was taken).

## Actions

1. **Add a documented `scratch-postgres` recipe or script** under `docs/runbooks/` or `tools/`, so coders can run every sql check locally (the 0011 gate failed only in CI). Owner: process packet. Size: S.
2. **Briefs say `git -C <worktree>` for every git command.** Coders and ops ran git in the primary checkout twice. Owner: orchestrator (brief template). Size: S.
3. **Derive the migrate test's expected migration list from the sql directory, or sort it.** Every packet that adds a migration collides on this list. Owner: process packet, with the next SQL packet. Size: S.
4. **Record, do not fix yet:** `tools/mcp-tokens/src/cli.test.ts` hit a 5000 ms timeout once; the Windows `colo-*` deploy tests time out on the `sh.exe` spawn. Together they make the local full check unreliable. Owner: orchestrator logs them in the flakes list. Size: S.
5. **Keep the five-pass review loop for security-sensitive packets.** Every pass found a real defect. Owner: orchestrator (campaign procedure). Size: S.
6. **Stop plans from saying "none" for a migration without checking the column need.** C7-02a was the miss. Owner: orchestrator, when it writes or updates a wave plan. Size: S.
7. **Split M packets that look like two sessions before dispatch.** About half the coders hit the context cap. Owner: orchestrator (sizing). Size: M.

## Carry-forward

The review-5 carry-forward is folded into the wave 2 cards: C7-03b (adapter, compensation by name, operator step), C7-04 (repeat start, 409, limiter admin exemption, `onAuditLost`), C7-06 (account token lines), C7-10 (audit encoding, refusals, per-name counts, redundant index, seed probe). See `packets/c7b-packets.md` and `packets/c7-user-management-packets.md`.
