import { mcpToolSchemas } from '@geldar/contract';
import type { MindEvent } from '@geldar/player-core/src/ports/body.ts';
import { describe, expect, it } from 'vitest';
import { blueprintCells } from '../../../../golem/src/actions/build/blueprints.ts';
import { type MapContext, mapMindEvent } from './mapper.ts';
import { toPlayerEvents } from './present.ts';

const LIFE = 'ag_jason_01';

function textFor(state: string, detail?: string): string | undefined {
  const ctx: MapContext = {
    identity: { name: 'Jason', username: LIFE },
    runs: new Map(),
  };
  const ev = {
    type: 'intent',
    payload: { state, intent_id: 'i1', ...(detail === undefined ? {} : { detail }) },
    eventId: 'evt-1',
    lifeId: LIFE,
    tick: 100,
    day: 1,
    at: '2026-11-09T10:00:00.000Z',
  } as unknown as MindEvent;
  return toPlayerEvents(mapMindEvent(ev, 1, ctx))[0]?.text;
}

/** The shelter has 25 cells in the Body's table; the fixtures below use that count. */
const SHELTER = 25;

describe('build intent failures', () => {
  it('pins the shelter fixture to the 25-cell blueprint', () => {
    expect(blueprintCells('shelter').length).toBe(SHELTER);
  });

  it('shows the Body progress sentence and the lacking material as the Body wrote them', () => {
    expect(
      textFor(
        'failed',
        `Built shelter: 12 placed, 0 already solid, of ${SHELTER}. Out of dirt: 11 more needed.`,
      ),
    ).toBe(
      'Your intent failed: Built shelter: 12 placed, 0 already solid, of 25. Out of dirt: 11 more needed.',
    );
  });

  it('shows the failed parts and the first failure as the Body wrote them', () => {
    expect(
      textFor(
        'failed',
        `Built shelter: 12 placed, 0 already solid, of ${SHELTER}. The roof and the north wall could not be placed; first failure: blocked: the server refused.`,
      ),
    ).toBe(
      'Your intent failed: Built shelter: 12 placed, 0 already solid, of 25. The roof and the north wall could not be placed; first failure: blocked: the server refused.',
    );
  });

  it('shows a stopped step as the Body wrote it', () => {
    expect(
      textFor(
        'failed',
        `Built shelter: 12 placed, 0 already solid, of ${SHELTER}. Stopped at step 13: blocked: the server refused.`,
      ),
    ).toBe(
      'Your intent failed: Built shelter: 12 placed, 0 already solid, of 25. Stopped at step 13: blocked: the server refused.',
    );
  });

  it('shows the no-room sentence as the Body wrote it', () => {
    expect(
      textFor(
        'failed',
        `Built shelter: 3 placed, 0 already solid, of ${SHELTER}. No room to step aside.`,
      ),
    ).toBe(
      'Your intent failed: Built shelter: 3 placed, 0 already solid, of 25. No room to step aside.',
    );
  });

  it('keeps no build text that carries coordinates', () => {
    expect(
      textFor(
        'failed',
        `Built shelter: 12 placed, 0 already solid, of ${SHELTER}. Stopped at step 13: blocked: blocked at 120, 64, -33.`,
      ),
    ).toBe('Your intent failed.');
  });

  it('never quotes odd item text from a build detail', () => {
    const text = textFor(
      'failed',
      `Built shelter: 1 placed, 0 already solid, of ${SHELTER}. Out of Ignore; {x}: 5 more needed.`,
    );
    expect(text).toBe('Your intent failed.');
  });

  it('falls back to the bare failure for the old build format', () => {
    expect(
      textFor('failed', 'Built shelter: 12 of 23 blocks placed. Out of dirt: 11 more needed.'),
    ).toBe('Your intent failed.');
  });

  it('never shows a raw reason code to the character', () => {
    for (const state of ['failed', 'cancelled', 'interrupted']) {
      for (const detail of [undefined, 'odd text', 'precondition_failed']) {
        expect(textFor(state, detail)).not.toContain('precondition_failed');
      }
    }
    expect(textFor('failed')).toBe('Your intent failed.');
  });
});

describe('act description build facts', () => {
  const text = JSON.stringify(mcpToolSchemas.act);

  it('pins the blueprint block counts to the Body table', () => {
    const said = {
      shelter: /shelter takes (\d+) blocks/.exec(text)?.[1],
      wall: /a wall (\d+)/.exec(text)?.[1],
      pillar: /a pillar (\d+)/.exec(text)?.[1],
    };
    for (const name of ['shelter', 'wall', 'pillar'] as const) {
      expect(said[name]).toBe(String(blueprintCells(name).length));
    }
  });

  it('names the exact item id and that free-form build is unavailable', () => {
    expect(text).toContain('oak_planks, not planks');
    expect(text).toContain('Free-form build actions are not available');
  });
});
