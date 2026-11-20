# AN-27a worknote: break provenance in the plugin

Status: code and tests done. Activation held (D-CS-06); nothing is switched on.

- `ProvenanceSink` (core-common) is the seam; `NatsBlockOwnerLink.send` publishes on `geldar.<shard>.provenance.<tail>` only for `break`, `pickup`, `take`, `combat`.
- `BlockChangeListener.onBreak` reads the prior owner from the cache before `record`, then sends one `break` JSON when the flag, the sink and `enabled` are all on. Nulls are serialised (`prior_owner: null`).
- The `changed` publish is unchanged (asserted in `flagOffOrNullSinkSendsNothingAndTheChangedPublishIsUnchanged`).

Ops (not run here, serial, scratch shard, after merge): capture one real `break` payload with CoreProtect present and one with it absent, and paste both below before AN-27b writes fixtures.

- CoreProtect present: pending
- CoreProtect absent: pending

Procedure: [capture-real-payloads](../../../runbooks/capture-real-payloads.md).
