/**
 * Admission (spec 5.3.4, 5.7): the rolling-hour credit counter that both the thinking loop and the
 * sleep reflection draw from, so one life has one budget. The loop's `Admission` (P0-30) is the one
 * implementation; the reflection (P0-31) depends on this port only.
 */

/** The cost of a thought in credits. */
export const THOUGHT_COST = 1;
/** The cost of a sleep reflection in credits. */
export const REFLECTION_COST = 2;

/** A granted reservation of credits. Exactly one of `settle` and `release` should be called. */
export interface AdmissionReservation {
  /** Credits held. */
  readonly cost: number;
  /** The call ran: the reserved cost stays charged. */
  settle(): void;
  /** The call never ran: give the credits back. The first of `settle` and `release` wins. */
  release(): void;
}

/** What the reflection and the loop ask of the admission counter. */
export interface ReflectionAdmission {
  /** Reserves `cost` credits, or returns null when they would take the hour over the cap. */
  reserve(cost: number): AdmissionReservation | null;
}
