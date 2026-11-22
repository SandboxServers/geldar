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

/**
 * Where the Body listens for a `survey` request (BLD-38e): `geldar.<shard>.body.<life_id>.survey`.
 * The request is a SurveyInput (mcp-survey.schema.json); the reply is a SurveyResult. Five tokens, so
 * it is outside the sink's `geldar.*.*` filter. Throws on a shard or life id the contract rejects.
 */
export function surveySubject(shard: string, lifeId: string): string {
  checked(shard, lifeId);
  return `geldar.${shard}.body.${lifeId}.survey`;
}

/**
 * Where the plugin sends a muffled notice (`heard_muffled`, heard-muffled-event.schema.json, decision 0199):
 * `geldar.<shard>.body.<life_id>.hearing`. Five tokens, so outside the sink's `geldar.*.*` filter. The body, mind
 * and mcp roles can all publish it today; the PubDeny that stops that is a later nats-auth change (MH-CH) and
 * must cover all three roles. Throws on a shard or life id the contract rejects.
 */
export function hearingSubject(shard: string, lifeId: string): string {
  checked(shard, lifeId);
  return `geldar.${shard}.body.${lifeId}.hearing`;
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
 * Where the plugin answers a `BlockOwnerQuery` (block-owner.schema.json) with a `BlockOwnerReply`:
 * `geldar.<shard>.blockowner.query`, a NATS request/reply subject. Four tokens, so outside the sink's
 * `geldar.*.*` filter. Throws on a shard name the contract rejects.
 */
export function blockownerQuerySubject(shard: string): string {
  if (!SHARD.test(shard)) throw new Error(`invalid shard name for a subject: ${shard}`);
  return `geldar.${shard}.blockowner.query`;
}

/**
 * Where the plugin publishes a `BlockOwnerChanged` (block-owner.schema.json) when one block's owner changes:
 * `geldar.<shard>.blockowner.changed`. Four tokens, so outside the sink's `geldar.*.*` filter.
 * Throws on a shard name the contract rejects.
 */
export function blockownerChangedSubject(shard: string): string {
  if (!SHARD.test(shard)) throw new Error(`invalid shard name for a subject: ${shard}`);
  return `geldar.${shard}.blockowner.changed`;
}

/**
 * Where the plugin publishes a break provenance (AN-24, decision 0343): `geldar.<shard>.provenance.break`.
 * Four tokens, so outside the sink's `geldar.*.*` filter. Throws on a shard name the contract rejects.
 */
export function provenanceBreakSubject(shard: string): string {
  if (!SHARD.test(shard)) throw new Error(`invalid shard name for a subject: ${shard}`);
  return `geldar.${shard}.provenance.break`;
}

/**
 * Where the plugin publishes a pickup provenance (AN-24): `geldar.<shard>.provenance.pickup`.
 * Four tokens, so outside the sink's `geldar.*.*` filter. Throws on a shard name the contract rejects.
 */
export function provenancePickupSubject(shard: string): string {
  if (!SHARD.test(shard)) throw new Error(`invalid shard name for a subject: ${shard}`);
  return `geldar.${shard}.provenance.pickup`;
}

/** Where the plugin publishes a container take provenance (AN-46, decision 0345): `geldar.<shard>.provenance.take`. Four tokens. */
export function provenanceTakeSubject(shard: string): string {
  if (!SHARD.test(shard)) throw new Error(`invalid shard name for a subject: ${shard}`);
  return `geldar.${shard}.provenance.take`;
}

/** Where the plugin publishes a combat provenance (AN-46): `geldar.<shard>.provenance.combat`. Four tokens. */
export function provenanceCombatSubject(shard: string): string {
  if (!SHARD.test(shard)) throw new Error(`invalid shard name for a subject: ${shard}`);
  return `geldar.${shard}.provenance.combat`;
}

/**
 * The wildcard over the provenance tokens (AN-24): `geldar.<shard>.provenance.>`. Four tokens.
 * Throws on a shard name the contract rejects.
 */
export function provenanceWildcard(shard: string): string {
  if (!SHARD.test(shard)) throw new Error(`invalid shard name for a subject: ${shard}`);
  return `geldar.${shard}.provenance.>`;
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

/**
 * The ops an owner's body control request may name. The supervisor's `OPS` (supervisor/src/ports.ts) is the
 * same list; a test there keeps the two equal, since the contract cannot import the supervisor.
 */
export const CTL_BODY_OPS = ['start', 'stop', 'restart', 'status', 'logtail'] as const;

/**
 * Where an owner's body control request goes (decision 0152, item 3): `geldar.<shard>.ctl.body.<op>`.
 * Five tokens, so outside the sink's `geldar.*.*` filter. Throws on a shard the contract rejects and on
 * an op outside `CTL_BODY_OPS`.
 */
export function ctlBodySubject(shard: string, op: string): string {
  if (!SHARD.test(shard)) throw new Error(`invalid shard name for a subject: ${shard}`);
  if (!(CTL_BODY_OPS as readonly string[]).includes(op))
    throw new Error(`invalid control op for a subject: ${op}`);
  return `geldar.${shard}.ctl.body.${op}`;
}

/**
 * The supervisor's subscription to every body control op of one shard: `geldar.<shard>.ctl.body.>`.
 * Throws on a shard name the contract rejects.
 */
export function ctlBodyWildcard(shard: string): string {
  if (!SHARD.test(shard)) throw new Error(`invalid shard name for a subject: ${shard}`);
  return `geldar.${shard}.ctl.body.>`;
}

/**
 * Where a Body asks the eventsink for a life's `ProficiencyState` (AN-02b), a core NATS request/reply:
 * `geldar.<shard>.state.<life_id>.proficiency`. Five tokens, so outside the sink's `geldar.*.*` filter.
 * Throws on a shard or life id the contract rejects.
 */
export function proficiencyRequestSubject(shard: string, lifeId: string): string {
  checked(shard, lifeId);
  return `geldar.${shard}.state.${lifeId}.proficiency`;
}

/**
 * Where the eventsink pushes a `ProficiencyLevelPayload` when a domain reaches a level (AN-02b), a core
 * NATS publish: `geldar.<shard>.state.<life_id>.level`. Five tokens. Throws on a shard or life id the
 * contract rejects.
 */
export function proficiencyPushSubject(shard: string, lifeId: string): string {
  checked(shard, lifeId);
  return `geldar.${shard}.state.${lifeId}.level`;
}

/**
 * The state subtree of one shard, `geldar.<shard>.state.>`: every proficiency request and push. It is
 * exactly the state subjects and nothing else. Throws on a shard name the contract rejects.
 */
export function stateWildcard(shard: string): string {
  if (!SHARD.test(shard)) throw new Error(`invalid shard name for a subject: ${shard}`);
  return `geldar.${shard}.state.>`;
}
