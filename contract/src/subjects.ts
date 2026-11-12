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

/**
 * Where the Body listens for a `BookRequest` and replies with a `BookReply` (WM-01 sovereign):
 * `geldar.<shard>.body.<life_id>.book`. Five tokens, like the other Body subjects, so it is
 * outside the sink's `geldar.*.*` filter. Throws on a shard or life id the contract rejects.
 */
export function bookSubject(shard: string, lifeId: string): string {
  checked(shard, lifeId);
  return `geldar.${shard}.body.${lifeId}.book`;
}

/**
 * Where the Body listens for an image request (decision 0156, VP-2) and replies with a base64 PNG
 * and a caption, or `{"error":"view_unavailable","detail":...}`:
 * `geldar.<shard>.body.<life_id>.image`. Five tokens. Throws on a shard or life id the contract rejects.
 */
export function viewImageSubject(shard: string, lifeId: string): string {
  checked(shard, lifeId);
  return `geldar.${shard}.body.${lifeId}.image`;
}

/**
 * Where the Body listens for a `view` request (the view-tool packet): `geldar.<shard>.body.<life_id>.view`.
 * The request is a ViewInput (mcp-view.schema.json); the reply is a ViewResult or `{"error":"unavailable"}`.
 * Five tokens, so it is outside the sink's `geldar.*.*` filter. Throws on a shard or life id the contract rejects.
 */
export function viewSubject(shard: string, lifeId: string): string {
  checked(shard, lifeId);
  return `geldar.${shard}.body.${lifeId}.view`;
}

/** The KV bucket of presence records, one key per life id (`PresenceRecord`, WM-01 sovereign). */
export const PRESENCE_BUCKET = 'geldar-presence';

/**
 * Where the Kino feed plugin publishes the feed messages of one agent (kino-feed.schema.json):
 * `geldar.<shard>.kino.<agent_id>.feed`. Five tokens, so outside the sink's `geldar.*.*` filter.
 */
export function kinoFeedSubject(shard: string, agentId: string): string {
  if (!SHARD.test(shard)) throw new Error(`invalid shard name for a subject: ${shard}`);
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(agentId))
    throw new Error(`invalid agent id for a subject: ${agentId}`);
  return `geldar.${shard}.kino.${agentId}.feed`;
}

/**
 * Where the deploy publishes a maintenance notice (maintenance-notice.schema.json, CD-1):
 * `geldar.<shard>.maintenance`. Three tokens, like the event subjects; the notice is not a WorldEvent.
 * Throws on a shard name the contract rejects.
 */
export function maintenanceSubject(shard: string): string {
  if (!SHARD.test(shard)) throw new Error(`invalid shard name for a subject: ${shard}`);
  return `geldar.${shard}.maintenance`;
}
