/**
 * A structural check for one Kino feed message, mirroring contract/schemas/kino-feed.schema.json.
 * Glass may not import the contract package (import-graph test), so the rules are written out here and
 * test/kino/feed-check.test.ts compares this check with the generated validator and fails on drift.
 * Anything that fails is dropped by the relay and counted as bad_feed; it is never forwarded.
 */

/** Largest message accepted: a chunk_section at the schema caps is about 1.09 MB. */
export const MAX_FEED_BYTES = 1_200_000;

const AGENT = /^[a-z][a-z0-9_]{0,63}$/;
const BLOCK_STATE =
  /^[a-z0-9_.-]+:[a-z0-9_/.-]+(\[[a-z0-9_]+=[a-z0-9_]+(,[a-z0-9_]+=[a-z0-9_]+)*\])?$/;
const ENTITY_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ENTITY_TYPE = /^[a-z0-9_.-]+:[a-z0-9_/.-]+$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const BYE = new Set([
  'unsubscribed',
  'target_not_permitted',
  'pane_cap_reached',
  'feed_unavailable',
  'feed_overloaded',
  'kill_switch',
  'session_ended',
]);

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : null;
}

/** Exactly these keys, no more and no fewer (every property of every message is required, except agent_id). */
function keys(o: Obj, required: string[], optional: string[] = []): boolean {
  const k = Object.keys(o);
  return (
    required.every((r) => k.includes(r)) &&
    k.every((x) => required.includes(x) || optional.includes(x))
  );
}

const int = (v: unknown, min: number, max: number): boolean =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const num = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, re: RegExp, max: number): boolean =>
  typeof v === 'string' && v.length <= max && re.test(v);
const agent = (v: unknown): boolean => str(v, AGENT, 64);
const block = (v: unknown): boolean => str(v, BLOCK_STATE, 256);

function entity(v: unknown): boolean {
  const e = obj(v);
  return (
    e !== null &&
    keys(e, ['id', 'type', 'x', 'y', 'z', 'yaw', 'pitch'], ['agent_id']) &&
    str(e.id, ENTITY_ID, 64) &&
    str(e.type, ENTITY_TYPE, 256) &&
    (e.agent_id === undefined || agent(e.agent_id)) &&
    num(e.x) &&
    num(e.y) &&
    num(e.z) &&
    num(e.yaw) &&
    num(e.pitch) &&
    (e.pitch as number) >= -90 &&
    (e.pitch as number) <= 90
  );
}

/** True when `v` is one valid feed message. Never throws. */
export function isFeedMessage(v: unknown): boolean {
  try {
    const m = obj(v);
    if (m === null) return false;
    switch (m.type) {
      case 'hello':
        return (
          keys(m, ['type', 'feed_version', 'world', 'target_agent_id', 'view_radius']) &&
          m.feed_version === 1 &&
          typeof m.world === 'string' &&
          m.world.length >= 1 &&
          m.world.length <= 64 &&
          agent(m.target_agent_id) &&
          int(m.view_radius, 1, 8)
        );
      case 'chunk_section':
        return (
          keys(m, ['type', 'chunk_x', 'chunk_z', 'section_y', 'palette', 'bits', 'data']) &&
          int(m.chunk_x, -1875000, 1875000) &&
          int(m.chunk_z, -1875000, 1875000) &&
          int(m.section_y, -128, 128) &&
          Array.isArray(m.palette) &&
          m.palette.length >= 1 &&
          m.palette.length <= 4096 &&
          m.palette.every(block) &&
          int(m.bits, 0, 12) &&
          str(m.data, BASE64, 24576)
        );
      case 'block_update': {
        const p = obj(m.pos);
        return (
          keys(m, ['type', 'pos', 'state']) &&
          p !== null &&
          keys(p, ['x', 'y', 'z']) &&
          int(p.x, -30000000, 30000000) &&
          int(p.y, -2048, 2048) &&
          int(p.z, -30000000, 30000000) &&
          block(m.state)
        );
      }
      case 'entity_positions':
        return (
          keys(m, ['type', 'entities']) &&
          Array.isArray(m.entities) &&
          m.entities.length <= 256 &&
          m.entities.every(entity)
        );
      case 'target_moved':
        return (
          keys(m, ['type', 'target_agent_id', 'x', 'y', 'z']) &&
          agent(m.target_agent_id) &&
          num(m.x) &&
          num(m.y) &&
          num(m.z)
        );
      case 'bye':
        return keys(m, ['type', 'reason']) && typeof m.reason === 'string' && BYE.has(m.reason);
      default:
        return false;
    }
  } catch {
    return false;
  }
}

/** Parses one NATS payload; true only when it is within the size bound, JSON and a valid message. */
export function validFeedText(json: string): boolean {
  if (json.length > MAX_FEED_BYTES || Buffer.byteLength(json) > MAX_FEED_BYTES) return false;
  try {
    return isFeedMessage(JSON.parse(json));
  } catch {
    return false;
  }
}
