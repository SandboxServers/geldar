import type { Reflex } from '../reflex.ts';
import { createEatReflex } from './eat.ts';
import { createFallStopReflex } from './fall-stop.ts';
import { createHazardEscapeReflex } from './hazard-escape.ts';

/**
 * The reflexes of P0-15a: fall-stop, hazard-escape and eat. Each call builds fresh instances, so
 * every Body gets its own (the eat reflex keeps a flag). Pass them to `BodyRuntime`'s `reflexes`.
 */
export function createBasicReflexes(): Reflex[] {
  return [createFallStopReflex(), createHazardEscapeReflex(), createEatReflex()];
}
