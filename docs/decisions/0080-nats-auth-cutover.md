# 0080. NATS auth cutover

- Status: Accepted (owner confirmed 2026-11-10)
- Date: 2026-11-10
- Spec: section 6.5 (Gateway with mTLS, step-ca); section 8.6 (host hardening); section 10 Phase 2 gates (a revoked Thinker is refused at Envoy). Decisions 0040, 0043, 0067, 0076.

## Problem

Decision 0067 adds NATS accounts and least-privilege users. It is an opt-in overlay (`compose/nats-auth.yml`). The shard command `./geldar.ps1 shard nats-auth` writes the users, the server config and the Thinker token into `compose/secrets/`. The overlay has not been tested against a live `nats-server` (RESUME.md, known gap). Its per-life subjects use `*`, because lives are not known when the file is written. The MCP role should be least-privilege (WM-10b). Thinkers need a way in that does not depend on the Phase 2 Gateway.

## Options

- **A. Keep the overlay opt-in until the Phase 2 Gateway.** No live risk now. The colo runs open NATS in Phase 1, which the campaign review flagged as unauthenticated.
- **B. Default-on cutover in wave C1, after a live `nats-server` test passes.** Credentials come from `compose/secrets/` through the shard command. Each role has its own user: Body, event sink, MCP (least-privilege), and one user per Thinker.
- **C. Cut over only when the colo moves** (wave C2). Leaves LAN Phase 1 open.

Thinker access (where the cutover meets spec 6.5):

- **T-1. Each Thinker holds its own NATS user.** Revocable by removing the user. Works in Phase 1, before the Gateway.
- **T-2. Thinkers reach NATS only through the Gateway, with mTLS (6.5).** This is the Phase 2 answer.

## Recommendation

- Use **B**, with **T-1** in Phase 1 and **T-2** at Phase 2.
- The cutover gate (all required before the default changes):
  1. A live `nats-server` test with the overlay, for every role.
  2. A revoked Thinker user is refused on its next connection.
  3. No subject from one shard is readable from another.
  4. The revert-check: the test fails with the overlay removed.
- Per-life subjects: replace the `*` placeholder with the life's subject once the life is known, or scope by shard and let the Body subscribe to its own life only. Decide in the packet that writes the overlay.
- Credential distribution: only through `compose/secrets/` and the shard command. Never in a committed file, and never in a brief.
- The Phase 2 gate "a revoked Thinker is refused at Envoy" replaces T-1 at Phase 2.

## Consequences

- The cutover changes the default for every shard, so the Phase 0 harness and the mock stack need the same credentials.
- A restore (decision 0076) must work with auth on: the NATS KV snapshot needs the account that owns the bucket.
- Revoking a Thinker in Phase 1 is a user delete, not a token rotation. The procedure goes in the runbook.

## Unblocks

- Wave C1: the live `nats-server` test and the default-on change.
- The least-privilege MCP user (WM-10b, the Wave M item).
- The Thinker pool enrolment (decision 0078).
- The backup restore test (decision 0076).
