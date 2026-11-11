# 0087. NATS overlay live test and scoped subjects

- Status: Proposed
- Date: 2026-11-10
- Spec: 6.5 (per-service NATS accounts), section 10 Phase 2 gates. Decisions 0067 (accounts and least-privilege users), 0080 (cutover gate). Packets: P1-C1-06a (this record's live test and subject table), P1-C1-06b (component credentials; cites this record, adds none).
- Worknote: [P1-C1-06a](../analysis/phase1/worknotes/P1-C1-06a.md)

## Problem

Decision 0067 gives each component its own NATS user. The overlay (`compose/nats-auth.yml`) had never run against a live `nats-server`. Decision 0080 makes the default change conditional on a live test. Two things were wrong in the overlay's subject lists: the per-life subjects used a bare `*`, because a life is not known when the config is written, and the test that decision 0080 requires did not exist.

## Cutover gate (0080)

Decision 0080 lists four conditions before the default changes. This record fixes how each is tested. The live test is `threshold/mcp/test/nats-auth.it.test.ts`, run with `GELDAR_IT=1` against a throwaway `nats-server` from the overlay's digest on a random loopback port.

1. **A live `nats-server` test with the overlay, for every role.** Every role (body, mind, eventsink, mcp, velocity, paper) connects with its password, has its allowed subjects accepted, and gets a permissions violation for a subject outside them. Covered by the "every role" test.
2. **A revoked Thinker user is refused on its next connection.** The revocation test removes a user from the config, sends SIGHUP to the server, and checks that the old password is refused. The other users still connect. Covered by the "revoked user" test. Phase 1 Thinkers are NATS users (0080 T-1), so the mind role is the revocation target.
3. **No subject from one shard is readable from another.** The isolation test checks that a shard A user cannot publish or subscribe on shard B's subjects, and that a shard B user can publish there (a control). Covered by the "shard isolation" test. KV buckets are not covered by this test (see below).
4. **The revert-check.** The test must fail with the overlay removed. This is checked by replacing the rendered config with an open server (`port: 4222` only): four of the six tests fail. The two that pass do not start a server.

A unit test in the same file asserts that the subject table has no bare `*` token (0080's per-life requirement).

## Scoped subject table

0080 leaves the per-life choice to the packet that writes the overlay. This record chooses: scope each role by shard and subject class, and leave the life part to the application check. A life is not known when the config is written, so no role is scoped to one life.

| Role | Publish | Subscribe |
|---|---|---|
| body | `geldar.<shard>.>`; JetStream API and ACK; `$KV.geldar-life-registry.>`, `$KV.geldar-checkpoints.>`, `$KV.geldar-body-generation.>` | `geldar.<shard>.body.>`; `_INBOX.>` |
| mind | `geldar.<shard>.<type>` for `wake`, `intent`, `action`, `plan_result`, `reflex_fired`, `speech`, `damage`, `death`, `sleep`; `geldar.<shard>.body.>`; JetStream API and ACK | `_INBOX.>` |
| eventsink | `geldar.<shard>.dlq`; JetStream API and ACK | `_INBOX.>` |
| mcp | `geldar.<shard>.sovereign_call`; `geldar.<shard>.body.>`; `$KV.geldar-presence.>`; JetStream API and ACK | `_INBOX.>` |
| velocity | `$KV.geldar-life-registry.>`, `$KV.geldar-skins.>`; JetStream API and ACK | `_INBOX.>` |
| paper | `geldar.<shard>.>`; JetStream API and ACK | `_INBOX.>` |

Every subject starts with a shard, or is a KV bucket, a JetStream API subject or an inbox. The table is the one in the test (`roleAllows`). The generator (`Initialize-NatsAuth` in `geldar.ps1`) does not yet emit this table; see "Generator defects" below.

## Consequences of the wider publish

The scoped table is wider than the per-life `*` lists it replaces in two places:

- **Body and paper publish to any depth under their shard** (`geldar.<shard>.>`). Before, a publish had to match one token (the per-life pattern). Now a body or paper user can publish to any subject in its shard, including another life's subjects. This is the price of not knowing lives at config time. The application check (the body or paper code only publishes its own life's subjects) is what limits it. The NATS layer does not.
- **Mind and mcp publish to `geldar.<shard>.body.>`.** Mind publishes plans to the body; mcp publishes sovereign calls there. Both can publish to any body subject of their shard, not only the plan subject.

Reading is narrower: body subscribes only to `geldar.<shard>.body.>`, and mind and mcp subscribe only to their inbox.

## KV buckets are not shard-scoped

The KV buckets (`geldar-life-registry`, `geldar-checkpoints`, `geldar-body-generation`, `geldar-presence`, `geldar-skins`) carry no shard in their names. A user with `$KV.<bucket>.>` can read that bucket across shards. The isolation test covers subjects, not KV. This is a known limit, flagged for the owner: a per-shard bucket split is a design question for a later packet, and it affects the restore path (0076) because the KV snapshot needs the bucket's account.

## Generator defects and who fixes them

The live test does not check the generator's output. Three defects are known, and they are fixed in C1-06c, after C1-02 merges (C1-02 owns `geldar.ps1`):

1. `Initialize-NatsAuth` puts `allow_responses: true` on the user block. nats-server 2.15.1 rejects it (`unknown field "allow_responses"`), so `./geldar.ps1 shard nats-auth` writes a config that does not start. It belongs inside `permissions`.
2. The generator still emits bare `*` per-life subjects and an `ops` user with `>` on every subject. No service in the overlay uses that user, but its grant is live in the generated config, and anyone holding its password has full access to the account.
3. The generator's subject table is not the scoped table above. C1-06c makes the generator output the table, and adds a test that renders the real generator output and starts a server with it (the same live harness as this record's test).

Until C1-06c merges, the live test proves the design, not the generated file. The overlay stays opt-in (0080 option A) until both the gate and C1-06c pass.

## Decision

- The cutover gate of 0080 is tested by `threshold/mcp/test/nats-auth.it.test.ts` as described above.
- The subject table is the scoped table above. The per-life `*` is removed from the design.
- The wider publish of body, paper, mind and mcp is accepted for Phase 1, with the application check as the limit, and recorded here.
- KV buckets stay shared across shards in Phase 1, flagged for the owner.
- The generator is brought in line with this table by C1-06c.

## Unblocks

- C1-06b: component credentials, which cite this record.
- C1-06c: the generator fix and its live test over the real output.
- The default-on cutover of 0080, once the gate passes and C1-06c is merged.
