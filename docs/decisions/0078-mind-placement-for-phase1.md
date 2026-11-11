# 0078. Mind placement for Phase 1

- Status: Proposed (owner confirms; the colo layout and the Thinker pool depend on it)
- Date: 2026-11-10
- Spec: section 6.1 (the Mind runs on the colo's Record/Mind host), section 6.3, section 10 Phase 1 (the Thinker pool is the owner's home GPUs and the `api-minds` Thinker, on the LAN or admin VPN), section 13. Decisions 0050, 0052 to 0055, 0070, 0071; the plan (plan.md, section (c), "Where the Mind runs").

## Problem

Three kinds of agent need thinking, and they need different things.

- **Adam-class agents** (Body-driven, our Mind): each wakeup runs the Mind, which asks a Thinker for a thought. These need a Mind and a Thinker.
- **Sovereign players** (0052 to 0055): the player's own MCP client drives them. They need no Mind of ours.
- **Rangers** (wave M): these run in Phase 1 as sovereign-tier agents.

Decision 0050 runs the Mind, the local Thinker and Adam's Body as host processes on the owner's desktop. Spec 6.1 puts the Mind on the colo's Record/Mind host. Phase 1 must pick one, and wave C1 needs the answer first.

## Options

- **A. Keep the Mind on the owner's desktop** (0050 extended to Phase 1). Simple. The Mind depends on a home machine for every thought, and the colo's agents stop when the desktop is off. Departs from spec 6.1.
- **B. The Mind on the colo's Record/Mind host (spec 6.1). Thinkers on the owner's home GPUs, reached through an enrolled gateway.** The desktop is one Thinker among others. Matches spec 6.1 and the Phase 1 text.
- **C. The Mind and the Thinkers both on the colo.** No home GPUs. Contradicts the Phase 1 text (the pool is the owner's GPUs).

## Recommendation

Use **B**.

- The Mind for Adam-class agents runs on the Record/Mind host.
- Thinkers run on the owner's home GPUs and on the `api-minds` Thinker. They are reached from the colo only through a Thinker gateway on the LAN or admin VPN, and a Thinker is revocable.
- Sovereign players run no Mind of ours. Their MCP client is their mind.
- The desktop stays a Thinker and a development host. It is not in the path of a running colo agent.

## Consequences

- The Record/Mind host needs a resource limit on the shared node (plan.md, the colo deploy item). Set it in wave C1.
- Hibernation (Phase 1 exit: an hour with a Thinker offline, zero deaths) is testable only if a Thinker can go offline while the Mind keeps running. B makes that test real.
- Thinker enrolment in Phase 1 is an interim: a token and a NATS user (decision 0080). Phase 2's Gateway with mTLS (spec 6.5) replaces it.
- Decision 0050 stays true for Phase 0. This record supersedes it for Phase 1 only when the owner accepts it.

## Unblocks

- Wave C1: the colo Mind host, its resource limits and the Thinker gateway.
- The Thinker pool packets (enrolment, lantern-local to gateway, per-Thinker response format, model pins; plan.md).
- The Phase 1 hibernation test.
