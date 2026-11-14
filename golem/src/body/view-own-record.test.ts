import { Vec3 } from 'vec3';
import { afterEach, describe, expect, it } from 'vitest';
import { type OwnerAnswer, setOwnerLookup } from '../actions/protected-blocks.ts';
import { fakeBot } from './body.fakes.ts';
import { createBodyView } from './view.ts';

/** A bot standing on the cell (-266, 34, 196) below its feet, as in Zack's ledge (decision 0196). */
function standingBody(answer: OwnerAnswer) {
  const bot = fakeBot();
  (bot as unknown as { username: string }).username = 'body_test';
  bot.entity.position = new Vec3(-265.5, 35, 196.5);
  setOwnerLookup(() => answer);
  return createBodyView(bot);
}

describe('onOwnPlacement reads the ownership record when the in-memory record is gone (item 4)', () => {
  afterEach(() => {
    setOwnerLookup(null);
  });

  it('is own when the ownership record names the Body, with no in-memory record', () => {
    const view = standingBody({ known: true, owner: 'body_test' });
    expect(view.onOwnPlacement).toBe(true);
    view.dispose();
  });

  it('is not own when the ownership record names another player, so idle_stuck still fires', () => {
    const view = standingBody({ known: true, owner: 'some_player' });
    expect(view.onOwnPlacement).toBe(false);
    view.dispose();
  });

  it('is not own when the ownership record holds no owner (world-generated)', () => {
    const view = standingBody({ known: true, owner: null });
    expect(view.onOwnPlacement).toBe(false);
    view.dispose();
  });

  it('is not own when the lookup cannot answer yet (unknown), so idle_stuck may fire', () => {
    const view = standingBody({ known: false });
    expect(view.onOwnPlacement).toBe(false);
    view.dispose();
  });

  it('is not own when no lookup is set at all', () => {
    setOwnerLookup(null);
    const bot = fakeBot();
    bot.entity.position = new Vec3(-265.5, 35, 196.5);
    const view = createBodyView(bot);
    expect(view.onOwnPlacement).toBe(false);
    view.dispose();
  });
});
