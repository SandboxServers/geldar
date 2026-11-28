export type { CombatFactPayload } from './evidence.ts';
export { encounterKey, validateCombatFactPayload } from './evidence.ts';
/** Observed-actor contract (AN-24, decision 0343, Proposed; nothing publishes these yet). */
export type { ObservationPayload, ObservedActor, Provenance } from './generated/types.ts';
/** Checks a heard_sound payload against heard-sound-event.schema.json (PX-4). Coordinates are rejected. */
export {
  /** Checks a heard_muffled payload against heard-muffled-event.schema.json (decision 0199, MH-1). Coordinates are rejected. */
  validateHeardMuffledPayload,
  validateHeardSoundEvent,
  validateObservationPayload,
  validateProvenance,
} from './generated/validators.js';
export { observationSentence, observedActorName } from './observation.ts';
export {
  provenanceBreakSubject,
  provenanceCombatSubject,
  provenancePickupSubject,
  provenanceTakeSubject,
  provenanceWildcard,
} from './subjects.ts';
