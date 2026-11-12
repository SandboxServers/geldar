import type { Snapshot } from '@geldar/contract';

/** Hunger below this is stated (the same line the regeneration rule draws, REGEN_MIN_HUNGER in the Body). */
export const SITUATION_HUNGER_BELOW = 18;
/** The most closing creatures named in the line. */
export const SITUATION_CLOSING_LIMIT = 4;

const SUN_TEXT: Readonly<Record<string, string>> = {
  morning: 'morning sun',
  midday: 'midday sun',
  afternoon: 'afternoon sun',
  low: 'sun low',
  set: 'sun set',
};

/**
 * One sentence of facts built only from the character's own senses, in a fixed order with fixed words:
 * sun, light, shelter, creatures closing (only mobs flagged hostile by type, decision 0154 ruling 1),
 * health trend, hunger. No advice and no coordinates. A part the Body did not send is left out;
 * undefined when no part is known.
 */
export function situationLine(snapshot: Snapshot): string | undefined {
  const parts: string[] = [];
  const { self, surroundings } = snapshot;
  const sun = self.sun === undefined ? undefined : SUN_TEXT[self.sun];
  if (sun !== undefined) parts.push(sun);
  if (self.light !== undefined) parts.push(`${self.light} here`);
  if (surroundings.enclosed !== undefined) {
    parts.push(surroundings.enclosed ? 'enclosed' : 'not enclosed');
  }
  const closing = (surroundings.entities ?? [])
    .filter((e) => e.hostile === true && (e.closing === true || e.state === 'closing'))
    .slice(0, SITUATION_CLOSING_LIMIT)
    .map((e) => `${e.type.replaceAll('_', ' ')} ${e.direction}`);
  if (closing.length > 0) parts.push(`closing: ${closing.join(', ')}`);
  if (self.health_trend !== undefined) parts.push(`health ${self.health_trend}`);
  if (self.hunger < SITUATION_HUNGER_BELOW) parts.push(`hunger ${self.hunger}`);
  if (parts.length === 0) return undefined;
  const text = parts.join('; ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}
