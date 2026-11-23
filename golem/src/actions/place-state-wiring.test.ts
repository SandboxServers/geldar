import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { type FakeBot, fakeBot, place } from './place.fakes.ts';
import { placeAction } from './place.ts';
import { type PlaceState, STATE_UNACHIEVABLE } from './place-state.ts';

/** Places with a program-only block state, as `ActionContext.placeState` carries it. */
function placeWithState(fake: FakeBot, block: string, at: Vec3, state: PlaceState) {
  return placeAction.run(
    { bot: fake.bot, signal: new AbortController().signal, timeScale: 1, placeState: state },
    { do: 'place', block, at: { x: at.x, y: at.y, z: at.z } },
  );
}

/** The properties the fake holds for the cell. */
function stateAt(fake: FakeBot, at: Vec3): Record<string, string> {
  return (
    fake.bot.blockAt(at) as unknown as { getProperties(): Record<string, string> }
  ).getProperties();
}

describe('place with a block state', () => {
  it('places a log on the x axis when the clicked face is an x face', async () => {
    // The target is (2,64,0); stone lies to its west, so the click is on an x face.
    const fake = fakeBot({
      items: ['oak_log'],
      blocks: { '1,64,0': 'stone', '2,63,0': 'stone' },
    });
    const result = await placeWithState(fake, 'oak_log', new Vec3(2, 64, 0), { axis: 'x' });
    expect(result.status).toBe('completed');
    expect(stateAt(fake, new Vec3(2, 64, 0))).toEqual({ axis: 'x' });
  });

  it('refuses a stair facing before any look or click, since no stair facing is verified', async () => {
    // The target is (2,64,0); stone lies above it, so the top face gives a top half.
    const fake = fakeBot({
      items: ['oak_stairs'],
      blocks: { '2,65,0': 'stone' },
    });
    const result = await placeWithState(fake, 'oak_stairs', new Vec3(2, 64, 0), {
      facing: 'east',
      half: 'top',
    });
    expect(result).toMatchObject({ status: 'failed', reason: STATE_UNACHIEVABLE });
    expect(fake.look).not.toHaveBeenCalled();
    expect(stateAt(fake, new Vec3(2, 64, 0))).toEqual({});
  });

  it('places a stair with a half and no facing, from the block above it', async () => {
    const fake = fakeBot({
      items: ['oak_stairs'],
      blocks: { '2,65,0': 'stone' },
    });
    const result = await placeWithState(fake, 'oak_stairs', new Vec3(2, 64, 0), { half: 'top' });
    expect(result.status).toBe('completed');
    expect(stateAt(fake, new Vec3(2, 64, 0))).toEqual({ half: 'top' });
  });

  it('places a top slab on a block above the target', async () => {
    const fake = fakeBot({
      items: ['oak_slab'],
      blocks: { '2,65,0': 'stone' },
    });
    const result = await placeWithState(fake, 'oak_slab', new Vec3(2, 64, 0), { half: 'top' });
    expect(result.status).toBe('completed');
    expect(stateAt(fake, new Vec3(2, 64, 0))).toEqual({ type: 'top' });
  });

  it('returns state_unachievable and places nothing when no click gives a top slab', async () => {
    // Only a side neighbour: a side click gives a top half only at a cursor the placement does not send.
    const fake = fakeBot({
      items: ['oak_slab'],
      blocks: { '1,64,0': 'stone' },
    });
    const result = await placeWithState(fake, 'oak_slab', new Vec3(2, 64, 0), { half: 'top' });
    expect(result).toMatchObject({ status: 'failed', reason: STATE_UNACHIEVABLE });
    expect(fake.placeBlock).not.toHaveBeenCalled();
    expect(fake.bot.blockAt(new Vec3(2, 64, 0))?.name).toBe('air');
  });

  it('returns state_unachievable and places nothing for a state the block does not take', async () => {
    const fake = fakeBot({ items: ['stone'], blocks: { '2,63,0': 'stone' } });
    const result = await placeWithState(fake, 'stone', new Vec3(2, 64, 0), { axis: 'x' });
    expect(result).toMatchObject({ status: 'failed', reason: STATE_UNACHIEVABLE });
    expect(fake.placeBlock).not.toHaveBeenCalled();
  });

  it('places without a state the same as before when no state is asked', async () => {
    const fake = fakeBot({ items: ['oak_log'], blocks: { '2,63,0': 'stone' } });
    const result = await place(fake, 'oak_log', { x: 2, y: 64, z: 0 });
    expect(result.status).toBe('completed');
  });
});
