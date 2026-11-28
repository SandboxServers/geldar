import type { MindEvent } from '@geldar/player-core/src/ports/body.ts';
import { describe, expect, it } from 'vitest';
import { mapMindEvent } from '../mapper.ts';
import type { MapContext } from './types.ts';

const LIFE = 'life_px1';
const ctx: MapContext = {
  identity: { name: 'Ada', aliases: [] } as unknown as MapContext['identity'],
  runs: new Map(),
};

/** A plugin damage event as the Mind receives it, with the payload given. */
function damage(payload: Record<string, unknown>): MindEvent {
  return {
    type: 'damage',
    lifeId: LIFE,
    tick: 100,
    at: '2026-11-11T00:00:00.000Z',
    payload,
  } as unknown as MindEvent;
}

describe('damage text: the hurt event wording (PX-1)', () => {
  it('says the source, the bearing and the loss: an arrow from behind, 3 health', () => {
    const [e] = mapMindEvent(damage({ source: 'arrow', bearing: 'behind', amount: 3 }), 1, ctx);
    expect(e).toMatchObject({
      kind: 'damage',
      cause: 'An arrow hit you from behind. You lost 3 health.',
      amount: 3,
    });
  });

  it('reads an unknown source as other: no raw source text is copied', () => {
    const [e] = mapMindEvent(damage({ source: 'lightning', amount: 3 }), 1, ctx);
    expect(e).toMatchObject({ cause: 'You were hurt. You lost 3 health.' });
  });

  it('leaves a bearing off a fall, which has no attacker', () => {
    const [e] = mapMindEvent(damage({ source: 'fall', bearing: 'left', amount: 2 }), 1, ctx);
    expect(e).toMatchObject({ cause: 'You fell. You lost 2 health.' });
  });

  it('keeps the old cause wording for a damage with no hurt source', () => {
    const [e] = mapMindEvent(damage({ cause: 'ENTITY_ATTACK', amount: 2 }), 1, ctx);
    expect(e).toMatchObject({ cause: 'Something hit you.', amount: 2 });
  });

  it('keeps a zero amount at zero so the presenter says nothing', () => {
    const [e] = mapMindEvent(damage({ source: 'arrow', bearing: 'behind', amount: 0 }), 1, ctx);
    expect(e).toMatchObject({ amount: 0 });
  });
});

describe('damage actor: named only when the agent could know who hit them', () => {
  it('names a Minecraft name with a basis of seen', () => {
    const [e] = mapMindEvent(
      damage({ cause: 'ENTITY_ATTACK', amount: 2, actor: { name: 'Zack', basis: 'seen' } }),
      1,
      ctx,
    );
    expect(e).toMatchObject({ actor: 'Zack' });
  });

  it('drops a life id shaped name even with a basis: no actor on the line', () => {
    const [e] = mapMindEvent(
      damage({ cause: 'ENTITY_ATTACK', amount: 2, actor: { name: 'ag_ada_01', basis: 'seen' } }),
      1,
      ctx,
    );
    expect(e).not.toHaveProperty('actor');
  });

  it('drops a name with a digit even with a basis: no actor on the line', () => {
    const [e] = mapMindEvent(
      damage({ cause: 'ENTITY_ATTACK', amount: 2, actor: { name: 'Zack2', basis: 'seen' } }),
      1,
      ctx,
    );
    expect(e).not.toHaveProperty('actor');
  });

  it('drops an actor with no basis: no actor on the line', () => {
    const [e] = mapMindEvent(
      damage({ cause: 'ENTITY_ATTACK', amount: 2, actor: { name: 'Zack' } }),
      1,
      ctx,
    );
    expect(e).not.toHaveProperty('actor');
  });
});
