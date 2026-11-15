// Encounter memory for the fight-or-flee reflex (AN-08b). An encounter is one hostile hurting the Body
// again and again. A band roll is drawn once per encounter, not on every hit (integration plan 8: no
// per-tick reroll), so its call holds while the Body stays in the band. Every other call is decided
// again from the current health on each hurt, as the legacy rule does.
import type { ThreatCall } from '@geldar/psyche';
import type { BodyView } from '../view.ts';
import type { ThreatPolicy } from './threat-policy.ts';

/** Ticks without a hurt from the hostile that end an encounter (10 s). */
export const ENCOUNTER_GAP_TICKS = 200;

/** The band sits this far above the fight floor (psyche's threat.ts keeps the same 4; it is not exported). */
const BAND_HEADROOM = 4;

/** The facts that identify an encounter: who hurts the Body, and whether it holds a weapon. */
export interface EncounterFacts {
  hostile: string;
  armed: boolean;
  suicideMob: boolean;
}

/** An open encounter: the band roll's call and the last hurt that kept it open. */
interface Encounter extends EncounterFacts {
  lastHurtTick: number;
  call: ThreatCall;
}

/** One open encounter per Body view. The view outlives a life, so a respawn forgets it (forgetThreatEncounter). */
const encounters = new WeakMap<BodyView, Encounter>();

/** Forgets the Body's open encounter. Called on respawn, because the view is reused across lives. */
export function forgetThreatEncounter(view: BodyView): void {
  encounters.delete(view);
}

/** True when health is inside the band: above the floor, and at most BAND_HEADROOM above it. */
function inBand(health: number, floor: number): boolean {
  return health > floor && health <= floor + BAND_HEADROOM;
}

/**
 * The threat call for this hurt. A band roll's call is reused only while the same hostile (with the same
 * armed and suicide facts) keeps hurting within ENCOUNTER_GAP_TICKS and health is still in the band. Every
 * other call is decided from the current health. Without a finite world tick there is no memory, and a
 * tick that goes backwards ends the encounter, so each such hurt is decided afresh.
 */
export function threatCallFor(
  view: BodyView,
  policy: ThreatPolicy,
  facts: EncounterFacts,
): ThreatCall {
  const now = view.tick;
  if (typeof now !== 'number' || !Number.isFinite(now)) {
    encounters.delete(view);
    return policy.decide({ health: view.health, armed: facts.armed, suicideMob: facts.suicideMob });
  }
  const open = encounters.get(view);
  if (open !== undefined) {
    const gap = now - open.lastHurtTick;
    const sameHostile =
      open.hostile === facts.hostile &&
      open.armed === facts.armed &&
      open.suicideMob === facts.suicideMob;
    if (sameHostile && gap >= 0 && gap <= ENCOUNTER_GAP_TICKS) {
      open.lastHurtTick = now;
      if (inBand(view.health, policy.floor())) return open.call;
    } else {
      encounters.delete(view);
    }
  }
  const call = policy.decide({
    health: view.health,
    armed: facts.armed,
    suicideMob: facts.suicideMob,
  });
  if (call.why === 'band_roll') {
    encounters.set(view, {
      hostile: facts.hostile,
      armed: facts.armed,
      suicideMob: facts.suicideMob,
      lastHurtTick: now,
      call,
    });
  }
  return call;
}
