# AN-27a worknote: break provenance in the plugin

Status: code and tests done. Activation held (D-CS-06); nothing is switched on.

- `ProvenanceSink` (core-common) is the seam; `NatsBlockOwnerLink.send` publishes on `geldar.<shard>.provenance.<tail>` only for `break`, `pickup`, `take`, `combat`.
- `BlockChangeListener.onBreak` reads the prior owner from the cache before `record`, then sends one `break` JSON when the flag, the sink and `enabled` are all on. Nulls are serialised (`prior_owner: null`).
- The `changed` publish is unchanged (asserted in `flagOffOrNullSinkSendsNothingAndTheChangedPublishIsUnchanged`).

Ops (not run here, serial, scratch shard, after merge): capture one real `break` payload with CoreProtect present and one with it absent, and paste both below before AN-27b writes fixtures.

- CoreProtect present: captured below
- CoreProtect absent: captured below

CoreProtect absent (overlay not mounted, `prior_owner` null):

Captured 2026-11-20 at 73788889, shard phase0, case break-coreprotect-absent, subject geldar.phase0.provenance.break, validator: ok

```json
{"kind":"break","world":"world","x":1313,"y":200,"z":800,"actor":"ag_capb_02","prior_owner":null,"block":"cobblestone","tick":2064}
```

CoreProtect present (overlay mounted; owner query answered `ag_capa_01` for chunk 82,50 before the break; break 10001 ms after the query, inside the 30 s window):

Captured 2026-11-20 at 73788889, shard phase0, case break-coreprotect-present, subject geldar.phase0.provenance.break, validator: ok

```json
{"kind":"break","world":"world","x":1313,"y":200,"z":800,"actor":"ag_capb_02","prior_owner":"ag_capa_01","block":"cobblestone","tick":411}
```

Procedure: [capture-real-payloads](../../../runbooks/capture-real-payloads.md).
