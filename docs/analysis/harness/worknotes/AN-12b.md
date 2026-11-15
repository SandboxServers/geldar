# AN-12b worknote: sink wiring, state ACL and fixtures

**Process rule: this PR changes the generated NATS config (the `state` subtree grants in `geldar.ps1` Get-NatsUsers, for the eventsink and the body). It must NOT be queued before geldar-93's manual node step: the live NATS conf is edited by hand by geldar-93, and the batched ACL step must be applied on the node first.**

Branch `phase1/an-12b-sink-wiring`, from `origin/main` `f5784011`. Card: AN-12 (sink half), `docs/analysis/harness/work-packets-geldar-a.md` section AN-12. The Body half is AN-12a (`golem/`, not touched here).

## What changed

- `eventsink/src/sink-plan.ts` (new): `sinkPlan(env)` reads `GELDAR_SHARD`, `GELDAR_XP`, `GELDAR_PROFICIENCY_THRESHOLDS`. `startShardServices(plan, starters)` starts the state service and the outbox publisher only when a shard is named, and nothing otherwise.
- `eventsink/src/sink-plan.test.ts` (new): the unset path starts nothing (spies), a blank shard is unset, thresholds are not read with XP off, a malformed list fails with XP on, and custom thresholds with a shard are refused.
- `eventsink/src/main.ts`: reads the plan before connecting, starts the services before the consumer, passes `plan.xp` to `pgEventWriter`, and stops the services on shutdown.
- `geldar.ps1` (Get-NatsUsers): eventsink Sub gains `geldar.$s.state.>` (Pub already had it); body Sub gains `geldar.$s.state.>` (body Pub already covers the request subject `state.<life>.proficiency` through `geldar.$s.>`; body PubDeny keeps `state.*.level`). Nothing else changed: mcp, mind, kino, paper, velocity, deploy, supervisor, register, helper unchanged.
- `tools/repo-checks/src/nats-auth.test.ts`: the decision-0087 table (`expectedTable`) gains the two `state.>` subscriptions (body and eventsink). This edits an expected value of an existing exact-equality test; it is the one deviation from "do not change existing assertions" and it is needed, because the table test would otherwise fail on the intended ACL change.
- `tools/repo-checks/src/nats-auth-state.test.ts` (new): renders the real generator (pwsh) and checks: eventsink may publish and subscribe the state subtree; body may request and hear the push, and may not publish the push; paper may not publish the push and has no state subscription; mcp, mind and kino hold no state subject; only body and eventsink hold any state subject.
- `compose/colo.yml`, `compose/phase0.yml`: the eventsink service passes `GELDAR_SHARD`, `GELDAR_XP`, `GELDAR_PROFICIENCY_THRESHOLDS` through as null values (`KEY:`), which Compose sets only when the host variable is set. The colo eventsink had no shard env before this change (confirmed).
- `shards/character-fixture.yaml` (new): three disposable Bodies (all-3, aggression-1, aggression-5), `character: { mode: sheet, rolls: true }`, sheets in the shape of `contract/schemas/character-sheet.schema.json`. Never the live shard files.
- `tools/repo-checks/src/character-fixture.test.ts` (new): a plain YAML parse of the fixture. The loader-level parse (`parseCharacterConfig`, `normalizeSheet`) is AN-12a's test, in `golem/`, and is not duplicated here (golem is out of scope for this packet, and the import graph does not allow it from repo-checks).

## Decisions

- The state service is started without `thresholds` (AN-11a: the Body checks levels with the defaults). A custom `GELDAR_PROFICIENCY_THRESHOLDS` with a shard is therefore refused at startup (added guard; the alternative is every state reply refused as a level mismatch).
- Empty and blank values count as unset.
- Subscribing the body to `geldar.<s>.state.>` follows the card. AN-11a suggested the narrower `geldar.<s>.state.*.level`; the owner may prefer it (it hides other bodies' requests from each body).
- Replies to requests go to the `_INBOX.>` already granted to eventsink; no inbox narrowing is in this change (AN-11a's wider inbox item is not in the card).

## Open items (not done here)

- Per-life scoping of the state subject (open item in the card): unchanged.
- The sovereign player shape in the fixture (`player_id`, `life_id`, `name`, `character_sheet`) follows the card's shape note; AN-12a's loader tests decide whether a `username` key is also needed.
- `GELDAR_XP=1` must not be set while `awardsFor` is a stub. It is real now (AN-09a), so this is allowed; the building row stays off.

## Ranger activation proposal (not applied)

Proposed values only. Nothing in this table is in any shard file, compose file or environment. Enabling anything needs geldar-93's batched NATS ACL step applied on the node, with the owner's word; the live NATS conf is edited by hand by geldar-93.

| Item | Proposed value | Applied |
| --- | --- | --- |
| Sheet attributes | curiosity 3, common_sense 3, cleverness 3, aggression 4 (proposal, to review) | no |
| Sheet alignment | law 3, good 3 | no |
| Sheet op_modes | warrior 4, explorer 4, farmer 2, miner 2, builder 2, crafter 2, nitwit 1 (proposal) | no |
| `character.mode` | `sheet` | no |
| `character.rolls` | `true` (as the fixture) | no |
| `character.proficiency` | `{ enabled: true, thresholds: [10, 30, 70] }` | no |
| `GELDAR_SHARD` on eventsink | the shard name | no |
| `GELDAR_XP` on eventsink | `1` (after the owner's word) | no |
| Live NATS conf | state subtree grants (this PR) | no, geldar-93's hand edit |

## Checks

Recorded in the report for this packet (vitest on `eventsink/src` and `tools/repo-checks/src/nats-auth*` plus the new fixture test; tsc `--noEmit` for eventsink; biome; `git diff --check`; `pnpm check:repo`).

## Fix pass (review of d047d6e8)

This section supersedes the stale parts above (the fixture summary, the state.> grants, the GELDAR_SHARD switch and the compose lines).

- Merge: origin/main is merged as a21434ac. The geldar.ps1 conflict is resolved as a union: the MH-CH hearing denies (body, mind, mcp) and the state grants both stay.
- ACL narrowed (owner ruling): body Sub is `geldar.<s>.state.*.level` (was state.>); eventsink Sub is `geldar.<s>.state.*.proficiency` (was state.>). Pub lists are unchanged. Body keeps `_INBOX.>` in its Sub: replies to its request arrive there, and the generated config grants it. The exact table (nats-auth.test.ts), the bare-token check (one exception each for the two exact subjects) and nats-auth-state.test.ts are updated. Revert mutations that widen either grant back to state.> fail by name.
- Sink switch: GELDAR_SHEET_SHARD, a dedicated variable. Deviation from the card: GELDAR_SHARD is the ambient operator variable (.env.example, deploy/colo-notice.sh, compose/colo.yml), so GELDAR_SHARD alone starts nothing (tested).
- Compose: the three null keys are removed from compose/colo.yml and compose/phase0.yml (the golden test). The opt-in file is compose/sheet-sink.yml, in no default file set. Operator use: `docker compose -f compose/colo.yml -f compose/sheet-sink.yml up -d eventsink`. Apply the ACL first (`./geldar.ps1 shard nats-auth`, see the runbook).
- Tests: the activation config (shard, XP on, default thresholds) succeeds and starts both services. eventsink/src/main.test.ts covers unset, ambient GELDAR_SHARD only, the activation path, and the SIGTERM order (consumer, state, outbox, drain). Mutations M-a (writer drops plan.xp), M-b (no service stop) and M-c (services with no shard), and S2 (guard always throws), each fail by name.
- Known limitation (AN-12 follow-up): the outbox is not shard-filtered. A row of another shard publishes to its own shard's subject, the server drops it by ACL, and the row is marked published.
- Ops note: pg.Pool has max 2, shared by the writer, the outbox pass and the state reads (2 s read timeout). A saturated pool answers unavailable. Watch for it during activation.