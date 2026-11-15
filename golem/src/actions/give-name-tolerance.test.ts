import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { NOT_IN_SIGHT } from './give.ts';
import { setup } from './give-test-fixture.ts';

describe('give: a recipient named loosely (decision 0334)', () => {
  it('resolves a display name that exactly one visible player has, then tosses', async () => {
    const { world, run, toss } = setup();
    world.entities[2] = {
      type: 'player',
      username: 'Pike',
      displayName: 'Mara',
      position: new Vec3(0.5, 64, 2.5),
    };
    const out = await run('mara');
    expect(out).not.toMatchObject({ message: NOT_IN_SIGHT });
    expect(toss).toHaveBeenCalledTimes(1);
  });

  it('gives the same refusal for an absent, a walled, a far, an ambiguous and an unknown name (decision 0145)', async () => {
    const { world, run, toss } = setup();
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    world.entities[3] = {
      type: 'player',
      username: 'ag_far_01',
      position: new Vec3(0.5, 64, 40.5),
    };
    // Two visible players share the display name `Dup`: a loose name matching both resolves to neither.
    world.entities[4] = {
      type: 'player',
      username: 'ag_dup_01',
      displayName: 'Dup',
      position: new Vec3(-4.5, 64, 2.5),
    };
    world.entities[5] = {
      type: 'player',
      username: 'ag_dup_02',
      displayName: 'Dup',
      position: new Vec3(4.5, 64, 2.5),
    };
    for (let x = -1; x <= 1; x++) world.set('stone', x, 64, 1);
    for (let x = -1; x <= 1; x++) world.set('stone', x, 65, 1);
    const outcomes = [];
    for (const name of ['Nobody', 'Pike', 'ag_far_01', 'dup', 'Zebra']) {
      outcomes.push(await run(name));
    }
    for (const out of outcomes) {
      expect(out).toEqual(outcomes[0]);
      expect(out).toMatchObject({ status: 'failed', reason: 'not_found', message: NOT_IN_SIGHT });
    }
    expect(toss).not.toHaveBeenCalled();
  });
});
