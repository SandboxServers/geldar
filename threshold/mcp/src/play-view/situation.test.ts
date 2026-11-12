import type { Snapshot } from '@geldar/contract';
import { markedWords } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { selfProjector } from './self.ts';
import { situationLine } from './situation.ts';

const options = { budget: 37, daysSinceSleep: 2 };

function snapshotWith(
  self: Record<string, unknown>,
  surroundings: Record<string, unknown> = {},
): Snapshot {
  return {
    self: { health: 20, hunger: 20, ...self },
    surroundings: { entities: [], ...surroundings },
  } as unknown as Snapshot;
}

const ZOMBIE = { type: 'zombie', direction: 'north', hostile: true, closing: true };

describe('situationLine', () => {
  it('states a dark night with a hostile closing and low hunger', () => {
    const line = situationLine(
      snapshotWith(
        { sun: 'set', light: 'dark', health_trend: 'falling', hunger: 6 },
        {
          enclosed: false,
          entities: [
            ZOMBIE,
            { type: 'wither_skeleton', direction: 'east', hostile: true, state: 'closing' },
            { type: 'cow', direction: 'south', closing: true },
            { type: 'spider', direction: 'west', hostile: true, state: 'idle' },
          ],
        },
      ),
    );
    expect(line).toBe(
      'Sun set; dark here; not enclosed; closing: zombie north, wither skeleton east; health falling; hunger 6.',
    );
  });

  it('states a calm day without hunger or creatures', () => {
    const line = situationLine(
      snapshotWith(
        { sun: 'midday', light: 'bright', health_trend: 'steady' },
        { enclosed: false, entities: [{ type: 'cow', direction: 'south' }] },
      ),
    );
    expect(line).toBe('Midday sun; bright here; not enclosed; health steady.');
  });

  it('is absent when the snapshot carries none of the fields', () => {
    expect(situationLine(snapshotWith({}))).toBeUndefined();
  });

  it('passes the agent-text scan and holds no advice words', () => {
    const line = situationLine(
      snapshotWith(
        { sun: 'low', light: 'dim', health_trend: 'rising', hunger: 3 },
        { enclosed: true, entities: [ZOMBIE] },
      ),
    );
    expect(markedWords(line ?? '')).toEqual([]);
    expect(line).not.toMatch(/\b(go|run|should|must|try|need|avoid|eat|flee)\b/i);
    expect(line).not.toMatch(/-?\d{2,}/);
  });
});

describe('selfProjector: light and regeneration', () => {
  const hint = 'Health does not regenerate naturally while hunger is low. Hunger falls over time.';

  it('carries light, health_trend and regen_hint when the Body sent them', () => {
    const view = selfProjector(
      snapshotWith({ light: 'dim', health_trend: 'falling', regen_hint: hint }),
      options,
    );
    expect(view.self).toMatchObject({ light: 'dim', health_trend: 'falling', regen_hint: hint });
  });

  it('leaves the three keys out when the Body did not send them', () => {
    const view = selfProjector(snapshotWith({}), options);
    for (const key of ['light', 'health_trend', 'regen_hint']) {
      expect(view.self).not.toHaveProperty(key);
    }
  });
});
