/**
 * Turns a `WorldEvent` off the wire into the `MindEvent` the Mind reads (spec 5.2, section 7).
 * The envelope is validated against the contract, then the payload against the schema of its
 * type. Types the Mind does not act on are not an error: they are `ignored`.
 */
import {
  validateActionRecord,
  validateIntentEventPayload,
  validatePlanResultPayload,
  validateReflexFiredPayload,
  validateSpeechPayload,
  validateWakePayload,
  validateWorldEvent,
  type WorldEvent,
} from '@geldar/contract';
import type { MindEvent, MindEventType } from '../ports/index.ts';

/** The event types the Mind reads, in the order the event source filters them. */
export const MIND_EVENT_TYPES: readonly MindEventType[] = [
  'wake',
  'intent',
  'action',
  'plan_result',
  'reflex_fired',
  'speech',
  'damage',
  'death',
  'sleep',
];

/** The subjects the Mind's event source filters on: `geldar.<shard>.<type>` for each Mind type. */
export function mindEventSubjects(shard: string): string[] {
  return MIND_EVENT_TYPES.map((type) => `geldar.${shard}.${type}`);
}

/** The outcome of normalising one message. */
export type Normalised =
  /** A valid event of a type the Mind reads. */
  | { status: 'event'; event: MindEvent; agentId: string | null }
  /** A valid envelope of a type the Mind does not read. */
  | { status: 'ignored'; type: string }
  /** The message fails the contract; `reason` says where. */
  | { status: 'invalid'; reason: string };

/** The per-type payload check: null when the payload is fine, else the first problems. */
type PayloadCheck = (payload: unknown) => string[] | null;

function schemaCheck(
  validate: (value: unknown) => { ok: boolean; errors?: string[] },
): PayloadCheck {
  return (payload) => {
    const verdict = validate(payload);
    return verdict.ok ? null : (verdict.errors ?? ['invalid']);
  };
}

/** Plugin events carry free-form payloads: they only have to be objects. */
const freeForm: PayloadCheck = (payload) =>
  typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? null
    : ['payload must be an object'];

const PAYLOAD_CHECKS: Record<MindEventType, PayloadCheck> = {
  wake: schemaCheck(validateWakePayload),
  intent: schemaCheck(validateIntentEventPayload),
  action: schemaCheck(validateActionRecord),
  plan_result: schemaCheck(validatePlanResultPayload),
  reflex_fired: schemaCheck(validateReflexFiredPayload),
  speech: schemaCheck(validateSpeechPayload),
  damage: freeForm,
  death: freeForm,
  sleep: freeForm,
};

function isMindType(type: string): type is MindEventType {
  return (MIND_EVENT_TYPES as readonly string[]).includes(type);
}

/**
 * Validates `raw` (a parsed message body) as a `WorldEvent` and its payload by type, and flattens
 * it. `agentId` is the envelope's `agent_id` (null when the event has none): the caller decides
 * whose events to keep.
 */
export function normaliseEvent(raw: unknown): Normalised {
  const envelope = validateWorldEvent(raw);
  if (!envelope.ok) return { status: 'invalid', reason: `envelope: ${envelope.errors.join('; ')}` };
  const world: WorldEvent = envelope.value;
  if (!isMindType(world.type)) return { status: 'ignored', type: world.type };
  const problems = PAYLOAD_CHECKS[world.type](world.payload);
  if (problems !== null) {
    return { status: 'invalid', reason: `${world.type} payload: ${problems.join('; ')}` };
  }
  const event = {
    type: world.type,
    payload: world.payload,
    eventId: world.source_event_id,
    lifeId: world.agent_id ?? '',
    tick: world.world_tick,
    day: world.world_day,
    at: world.at,
  } as MindEvent;
  return { status: 'event', event, agentId: world.agent_id ?? null };
}
