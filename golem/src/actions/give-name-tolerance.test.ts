import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { REGISTRY_PLAYER_NAME } from '../perception/perception.fakes.ts';
import { NOT_IN_SIGHT } from './give.ts';
import { setup } from './give-test-fixture.ts';

/** Walls the Body's view of (x, 64, 2) with stone at z=1, x -1..1, two blocks high. */
function wall(world: ReturnType<typeof setup>['world']): void {
  for (let x = -1; x <= 1; x++) world.set('stone', x, 64, 1);
  for (let x = -1; x <= 1; x++) world.set('stone', x, 65, 1);
}

describe('give: a recipient named loosely (decision 0334)', () => {
  it('resolves a tab-list display name that exactly one visible player has, then tosses', async () => {
    const { world, run, toss } = setup(5, { by: 'ag_mara_01' });
    world.entities[2] = {
      type: 'player',
      ...REGISTRY_PLAYER_NAME,
      username: 'ag_mara_01',
      position: new Vec3(0.5, 64, 2.5),
    };
    world.setPlayer('ag_mara_01', 'Mara');
    const out = await run('mara');
    expect(out).not.toMatchObject({ message: NOT_IN_SIGHT });
    expect(toss).toHaveBeenCalledTimes(1);
  });

  it('gives the same refusal for an absent, a walled, a far and an unknown name (decision 0145)', async () => {
    const { world, run, toss } = setup();
    world.entities[2] = {
      type: 'player',
      username: 'ag_wally_01',
      position: new Vec3(0.5, 64, 2.5),
    };
    world.setPlayer('ag_wally_01', 'Wally');
    world.entities[3] = {
      type: 'player',
      username: 'ag_far_01',
      position: new Vec3(0.5, 64, 40.5),
    };
    wall(world);
    const outcomes = [];
    for (const name of ['Nobody', 'Wally', 'ag_wally_01', 'ag_far_01', 'Zebra']) {
      outcomes.push(await run(name));
    }
    for (const out of outcomes) {
      expect(out).toEqual(outcomes[0]);
      expect(out).toMatchObject({ status: 'failed', reason: 'not_found', message: NOT_IN_SIGHT });
    }
    expect(toss).not.toHaveBeenCalled();
  });

  it('gives the same refusal for an ambiguous name whose two matches are both in sight (decision 0145)', async () => {
    const { world, run, toss } = setup();
    // Both Dup players are clear of any wall: the refusal here is for ambiguity, not for sight.
    world.entities[2] = {
      type: 'player',
      ...REGISTRY_PLAYER_NAME,
      username: 'ag_dup_01',
      position: new Vec3(-4.5, 64, 2.5),
    };
    world.entities[3] = {
      type: 'player',
      ...REGISTRY_PLAYER_NAME,
      username: 'ag_dup_02',
      position: new Vec3(4.5, 64, 2.5),
    };
    world.setPlayer('ag_dup_01', 'Dup');
    world.setPlayer('ag_dup_02', 'Dup');
    const outcomes = [];
    for (const name of ['Nobody', 'dup', 'Zebra']) {
      outcomes.push(await run(name));
    }
    for (const out of outcomes) {
      expect(out).toEqual(outcomes[0]);
      expect(out).toMatchObject({ status: 'failed', reason: 'not_found', message: NOT_IN_SIGHT });
    }
    expect(toss).not.toHaveBeenCalled();
  });

  it('lets an unseen agent with the same name change nothing (decision 0145)', async () => {
    const { world, run, toss } = setup(5, { by: 'ag_kit_01' });
    // Only an unseen agent is called Wally: the name is as absent as any unknown name.
    world.entities[2] = {
      type: 'player',
      username: 'ag_wally_01',
      position: new Vec3(0.5, 64, 2.5),
    };
    world.setPlayer('ag_wally_01', 'Wally');
    wall(world);
    expect(await run('Wally')).toMatchObject({ message: NOT_IN_SIGHT });
    expect(toss).not.toHaveBeenCalled();
    // A visible Kit resolves even with an unseen Kit beside it: the unseen one is not a candidate.
    // The wall comes down so the visible Kit is near enough to toss without a walk.
    for (let x = -1; x <= 1; x++) {
      world.clear(x, 64, 1);
      world.clear(x, 65, 1);
    }
    world.entities[3] = {
      type: 'player',
      username: 'ag_kit_01',
      position: new Vec3(1.5, 64, 2.5),
    };
    world.setPlayer('ag_kit_01', 'Kit');
    world.entities[4] = {
      type: 'player',
      username: 'ag_kit_02',
      position: new Vec3(0.5, 64, 40.5),
    };
    world.setPlayer('ag_kit_02', 'Kit');
    expect(await run('Kit')).not.toMatchObject({ message: NOT_IN_SIGHT });
    expect(toss).toHaveBeenCalledTimes(1);
  });
});
