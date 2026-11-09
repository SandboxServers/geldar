import type { Reflex } from '../reflex.ts';
import { createEatReflex } from './eat.ts';
import { createFallStopReflex } from './fall-stop.ts';
import { createHazardEscapeReflex } from './hazard-escape.ts';

/** The reflexes of P0-15a: fall-stop, hazard-escape and eat. Pass them to `BodyRuntime`'s `reflexes`. */
export const basicReflexes: readonly Reflex[] = [
  createFallStopReflex(),
  createHazardEscapeReflex(),
  createEatReflex(),
];
