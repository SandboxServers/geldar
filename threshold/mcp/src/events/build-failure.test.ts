import type { MindEvent } from '@geldar/animus/src/ports/body.ts';
import { mcpToolSchemas } from '@geldar/contract';
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

describe('build intent failures', () => {
  it('says how many blocks were placed and what is lacking', () => {
    expect(
      textFor('failed', 'Built shelter: 12 of 23 blocks placed. Out of dirt: 11 more needed.'),
    ).toBe('Your intent failed: you placed 12 of 23 blocks and lack 11 more dirt.');
    expect(
      textFor('failed', 'Built wall: 0 of 15 blocks placed. Out of oak_planks: 15 more needed.'),
    ).toBe('Your intent failed: you placed 0 of 15 blocks and lack 15 more oak planks.');
  });

  it('says the next spot was blocked when a step stopped', () => {
    expect(
      textFor(
        'failed',
        'Built shelter: 12 of 23 blocks placed. Stopped at step 13: blocked: the server refused',
      ),
    ).toBe('Your intent failed: you placed 12 of 23 blocks, then the next spot was blocked.');
  });

  it('says when there was no cell to step aside into', () => {
    expect(textFor('failed', 'Built shelter: 3 of 23 blocks placed. No room to step aside.')).toBe(
      'Your intent failed: you placed 3 of 23 blocks, then there was no free cell to step aside into.',
    );
  });

  it('never quotes odd item text from a build detail', () => {
    const text = textFor(
      'failed',
      'Built shelter: 1 of 23 blocks placed. Out of Ignore; {x}: 5 more needed.',
    );
    expect(text).toBe('Your intent failed: you placed 1 of 23 blocks.');
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
