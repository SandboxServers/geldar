# 0280. Proficiency contract and state subjects

- Status: Accepted.
- Date: 2026-11-14
- Spec: none. This is a contract record for the character-sheet campaign; `docs/spec.md` is not edited.
- Related: 0186 (D-CS-04, the award rules, assumed under decision 78), 0171 (sheet and world history), 0067 and 0080 (NATS least privilege); `docs/analysis/harness/work-packets-geldar-a.md` (AN-02b, and AN-04a the writer); PR #386 (branch `phase1/an-02b-contract-proficiency`)

## Context

AN-02b adds the shapes that the proficiency projection needs before the eventsink writer (AN-04a) and the Body reader exist: the seven skill domains, a request and reply on a NATS request subject, the level push, and the chunk-visit evidence event. The shapes live in `contract/schemas/` (four new files) and `contract/src/subjects.ts`. This record writes down the decisions they encode, so that a reader does not have to rebuild them from the schema text.

## Decision

1. **Domains.** Proficiency has seven domain values: `combat`, `farming`, `mining`, `building`, `crafting`, `exploring`, `social`. A state always carries all seven. No other domain is accepted.
2. **ProficiencyRequest** `{ life_id, have_version? }`. The reply is a ProficiencyState. An absent `have_version` means "anything": the requester asks for the current state. An empty request body means `have_version` is absent.
3. **ProficiencyState** `{ life_id, version, levels, sheet?, sheet_hash? }`.
   - `levels` has all seven domains. Each has `level` 0 to 3 and `xp` of 0 or more. A life with no rows answers `version` 0 and seven zero levels.
   - `version` is the total XP across all domains. It grows with every award, so no second counter is needed. The schema checks only that it is a non-negative integer. The writer (AN-04a) keeps it growing.
   - `sheet` is the adopted baseline (rule R-sheet, 0186 D-CS-03). `sheet_hash` is the lower-case hex SHA-256 of its canonical JSON, computed by the writer. The sheet goes only to the Body role and never to an agent. The NATS ACL is what keeps it from agents, not the schema.
4. **ProficiencyLevelPayload** `{ life_id, domain, level 1..3, xp, version }`. This is the core push body, sent when a domain reaches level 1 to 3. `version` is the total XP after the award. It carries no sheet and no true value.
5. **chunk_visited.** A WorldEvent type with payload `{ life_id, dimension, cx, cz, tick }`. It records the first visit of a life to a chunk, the evidence for exploring XP. It carries the chunk index only, never block coordinates. `cx` and `cz` are integers from -2000000 to 2000000, and `dimension` matches `^[a-z0-9_:.-]{1,64}$`. It is a three-token WorldEvent subject, so the sink sees it.
6. **State subjects.** Life-scoped state uses five tokens:
   - `geldar.<shard>.state.<life_id>.proficiency`: the request and reply (core NATS request/reply).
   - `geldar.<shard>.state.<life_id>.level`: the core push from the eventsink.
   - `geldar.<shard>.state.>`: the wildcard for the state subtree.

   Five tokens put these subjects outside the sink filter (`geldar.*.*`, three tokens), so the sink does not take them as world events. `contract/src/subjects.ts` builds them with the shard and life id checks already in use, and refuses a dot or a wildcard inside a token.

## Why

- The seven domains are fixed by D-CS-04 (0186). Total XP as `version` gives a monotonic value that the writer can check against the rows, with no counter to drift.
- The sheet is a baseline that a Body needs to run its character. Sending it on the request reply, with the ACL limiting the reply to the Body role, keeps it off agent-visible subjects.
- State subjects sit outside the sink filter, so the sink never reads a proficiency request as a world event.

## Consequences

- AN-04a must keep `version` non-decreasing (strictly increasing on each award) and compute `sheet_hash` from the canonical JSON.
- **Known gap.** The `body` and `paper` NATS roles hold a broad publish permission on `geldar.<shard>.>`. That covers `geldar.<shard>.state.<life_id>.level`, so a Body can forge a level push to the core. No schema can stop this, and the current ACL does not deny it. This record accepts the gap until the follow-up below lands.
- **Follow-up (ACL card).** Deny publish on `state.*.level` to the `body` and `paper` roles in `Get-NatsUsers` (`geldar.ps1`), and add a case to the `tools/repo-checks` nats-auth test that proves the denial.
- `contract/src/index.ts` is about 535 lines, above the 500-line soft cap. The AN-02b block should move to its own file in a later card. AN-02b does not move it.

## Open

- The ACL follow-up card is not yet written. Until it lands, the forged-push gap stands.
- The eventsink writer (AN-04a) that enforces the `version` and `sheet_hash` rules is not built.
