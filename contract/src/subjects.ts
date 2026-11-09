/**
 * NATS subjects of the Body-Mind channel (decision 0025, spec 5.3.2). The Mind asks the Body for
 * a snapshot and hands it plans over core NATS request/reply. The subjects have five tokens, so
 * they are deliberately outside the event stream's filter `geldar.*.*` (events are
 * `geldar.<shard>.<type>`, three tokens) and the sink never sees them.
 */

/** Same pattern as `ShardName` in common.schema.json. */
const SHARD = /^[a-z][a-z0-9-]{1,31}$/;

/** Same pattern as `LifeId` in common.schema.json. */
const LIFE_ID = /^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$/;

/** Throws when a token could add or widen subject tokens (a dot, a wildcard, a space). */
function checked(shard: string, lifeId: string): void {
  if (!SHARD.test(shard)) throw new Error(`invalid shard name for a subject: ${shard}`);
  if (!LIFE_ID.test(lifeId)) throw new Error(`invalid life id for a subject: ${lifeId}`);
}

/**
 * Where the Body listens for a `SnapshotRequest` and replies with a `Snapshot`:
 * `geldar.<shard>.body.<life_id>.snapshot`. Throws on a shard or life id the contract rejects.
 */
export function snapshotSubject(shard: string, lifeId: string): string {
  checked(shard, lifeId);
  return `geldar.${shard}.body.${lifeId}.snapshot`;
}

/**
 * Where the Body listens for a `PlanMessage` and replies with a `PlanAck`:
 * `geldar.<shard>.body.<life_id>.plan`. Throws on a shard or life id the contract rejects.
 */
export function planSubject(shard: string, lifeId: string): string {
  checked(shard, lifeId);
  return `geldar.${shard}.body.${lifeId}.plan`;
}
