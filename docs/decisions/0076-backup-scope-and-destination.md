# 0076. Backup scope and destination

- Status: Accepted (owner confirmed 2026-11-10)
- Date: 2026-11-10
- Spec: section 6.8 (backups), which does not say what a checkpoint contains; section 10, the Phase 2 gate "a coordinated checkpoint is restored on a scratch shard"; the Phase 1 colo layout. Decisions 0043, 0064, 0070.

## Problem

Body state spans three stores. Postgres holds records, intents, receipts and journals. NATS KV and JetStream hold Body checkpoints and generations, and the event stream (0043, 0041). The world directory holds the Paper world and player data. A backup of one store does not restore a Body, because the parts no longer agree.

Journals are not append-only yet: `adam-reset.ts` deletes rows, and decision 0064 says journals are append-only. Phase 1 cannot promise a backup that is replayable while rows can be deleted.

## Options

- **A. Postgres dump now, world later.** Cheap. A restore gives records with no matching world or checkpoint. Rejected.
- **B. One coordinated checkpoint.** Pause world saving, flush the Body, then take a Postgres logical dump, a NATS KV and JetStream snapshot, and a world copy. All parts carry one checkpoint ID, and a manifest records each part's hash. A restore uses only a complete set.
- **C. Each store on its own schedule, reconciled at restore by timestamp.** Simple to run. Restore then needs reconciliation logic that Phase 0 did not finish (crash reconciliation is partial; known-gaps, size L).

Destination (the owner's choice, not a design question here):

- **D1.** A second disk on the colo node.
- **D2.** An off-node object store.
- **D3.** Both.

## Recommendation

- Use **B**.
- Checkpoint contents: a Postgres logical dump; a NATS KV and JetStream snapshot (checkpoint and generation keys, and the event stream); a world directory copy taken with saving paused; and a manifest with the checkpoint ID, the image digest, and a hash per part.
- Make journal and receipt tables append-only: no `DELETE` or `UPDATE` on them. A reset creates a new shard rather than deleting rows.
- Encrypt every copy at rest. Key handling is the owner's.
- Destination: **D3** is recommended. The owner decides.
- Restore test: restore a checkpoint onto a scratch shard and run the Body benchmark there. This is the Phase 2 gate in spec section 10, moved earlier. Run it at every wave boundary in Phase 1.

## Owner ruling (2026-11-10)

Scope B is accepted. The destination (D1, D2 or D3) and the backup build are DEFERRED by the owner (decision 0130). Consequence: until backups exist, a running colo shard has no restore path. So the shard stays invite-only and unannounced, nothing irreplaceable lives on it, and the first restore test moves to the end-of-phase gates. The append-only journal change (C1-05a) is NOT deferred.

## Consequences

- The append-only rule changes `adam-reset.ts` and every journal delete path. One packet owns that change, with a revert-check.
- Every wave boundary gains a restore test, which costs about one shard-hour.
- The manifest is a file format. It goes in `contract/` only if a tool outside the backup job reads it. Decide in the unblocker packet.
- The NATS KV part depends on decision 0080 (NATS auth cutover): a restore must work with auth on.

## Unblocks

- The backup packets, scoped by the wave plan.
- The journal append-only change.
- The restore test in the wave-boundary gate (packet conventions, section 4.2).
- Phase 1's "7 real days of continuous operation" exit, which assumes a restore is possible.
