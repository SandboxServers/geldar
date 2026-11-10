# 0070. Phase 1 is the colo-first shard: final environment, invite-only, not announced

- Status: Accepted (owner, 2026-11-10)
- Date: 2026-11-10
- Spec: section 10 (the phase plan, lines 1398 to 1426, including "nothing is exposed to the internet until Phase 2" at line 1398), 6.1 and 6.2 (the colo layout). This record amends the spec's phase plan for sequencing only; the spec's exit criteria remain the targets of the later waves.

## Decision

Phase 1 means **the shard in its final Colo environment, reachable from the internet without a VPN, invite-only and not announced**. "Not live" means no public launch and no announcement. The endpoints exist and people join only by an invitation the owner issues.

1. **Pulled forward from spec Phase 2 into Phase 1:**
   - the public MCP endpoint (spec 6.2, Geldar MCP), with the static bearer tokens of decision 0054;
   - the public Velocity endpoint (spec 6.2, spectator proxy), on the port that decision 0071 sets;
   - the Observatory-class viewers, Glass (the Thought Stream) and BlueMap, public under decision 0072;
   - backups (spec 6.8), with a restore tested on a scratch shard;
   - deployment on the Colo in the internal and DMZ zones of spec 6.1 and 6.2.
2. **Moved to later waves on the Colo** (waves C3 and C4 in [the Phase 1 plan](../analysis/phase1/plan.md)): the spec's Phase 1 content. That is proximity chat, books and skills, sleep reflection, hibernation, credits (allowance only), the Shrine and birth, the Thinker pool (desktop GPUs and the `api-minds` Thinker), memory and skills, a population of 10 to 15 agents, and the 7-day soak.
3. **Invitations wait for the gates.** The eight gates of spec Phase 2 are the entry bar for any invitee. The endpoints may be up before the gates pass, but until they pass only the owner's accounts and tokens are admitted. Wave C2's exit check is the gate check.
4. **The phase closes at wave C2's exit,** when the shard is reachable, gated and watched. The spec's Phase 1 exit criteria (the mechanism demo, the 7-day soak, and the rest of spec section 10 for Phase 1) are the targets that waves C3 and C4 must meet on the Colo.

### The spec's own Phase 1 inconsistency

Spec Phase 1 excludes "no permadeath, no Shrine" (line 1414), yet its exit (line 1418) requires a shrine that issues from a bounded pool, and a death and a birth with distinct life IDs. This record does not pick a winner on content. It settles sequencing only: the Shrine and the birth are built in wave C4, because the exit requires them, and the exclusion list does not apply to the Colo phase. The spec's wording stays as it is (decision 0073).

## Why

- Phase 0 is closed as proof of life (decision 0066), and its exit runs are deferred. The spec's Phase 1 plan (a LAN-only village on home GPUs and the admin VPN) assumed the shard would not yet be on the Colo. The owner has ruled that the shard runs on the Colo node.
- Building the village on a LAN-only shard and then moving it would move the same state twice and soak it twice.
- Exposing the real surfaces early, to invited people only, tests the security and operations work against the real endpoints, not against mocks.

## Consequences

- The spec's line "Nothing is exposed to the internet until Phase 2" (line 1398) no longer holds. The security build-out that spec Phase 2 lists (the DMZ hardening of 8.6, the supply-chain pipeline of 8.7, the external review of 8.9) moves into waves C1 and C2, and it must be done before any public surface opens.
- The Observatory SSO of spec 8.4 does not apply to Glass and BlueMap (decision 0072). Grafana and the "Create player" form stay private until the owner decides otherwise.
- The phase name "Open the doors" no longer has its own content. Its eight gates stay as the bar for invitees.
- Phase 1 is named by its end state, not by a feature list, so the wave plan can change without a new decision as long as the end state holds.
- Spec amendments are recorded here, not made in the spec (decision 0073).
