import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { createPerception } from './index.ts';
import { FakeWorld } from './perception.fakes.ts';

/** The agents seen by a bot standing at `bot`, with one player standing at `agent`, in the clear. */
function agentsSeenFrom(bot: Vec3, agent: Vec3) {
  const world = new FakeWorld();
  world.me.position = bot;
  world.entities[1] = { type: 'player', username: 'Pike', position: agent, height: 1.8 };
  return createPerception(world.bot).surroundings().agents;
}

describe('agent pos: floored, and omitted when outside the snapshot schema range', () => {
  it('keeps pos for an agent at ordinary height, floored on every axis', () => {
    const [agent] = agentsSeenFrom(new Vec3(0.5, 64, 0.5), new Vec3(0.5, 64.7, 6.5));
    expect(agent).toHaveProperty('pos', { x: 0, y: 64, z: 6 });
  });

  it('keeps pos at the top of the y range: floored y 320', () => {
    const [agent] = agentsSeenFrom(new Vec3(0.5, 320, 0.5), new Vec3(0.5, 320.2, 3.5));
    expect(agent).toHaveProperty('pos', { x: 0, y: 320, z: 3 });
  });

  it('omits pos above the y range but keeps the agent listed: floored y 321', () => {
    const agents = agentsSeenFrom(new Vec3(0.5, 321, 0.5), new Vec3(0.5, 321.2, 3.5));
    expect(agents).toHaveLength(1);
    expect(agents[0]).not.toHaveProperty('pos');
    expect(agents[0]).toMatchObject({ name: 'Pike' });
  });

  it('omits pos below the y range: floored y -65', () => {
    const agents = agentsSeenFrom(new Vec3(0.5, -64.5, 0.5), new Vec3(0.5, -64.8, 3.5));
    expect(agents).toHaveLength(1);
    expect(agents[0]).not.toHaveProperty('pos');
  });

  it('omits pos past the positive x limit of 30000000', () => {
    const agents = agentsSeenFrom(new Vec3(30000000.5, 64, 0.5), new Vec3(30000001.5, 64, 0.5));
    expect(agents).toHaveLength(1);
    expect(agents[0]).not.toHaveProperty('pos');
  });

  it('omits pos past the negative z limit of -30000000', () => {
    const agents = agentsSeenFrom(new Vec3(0.5, 64, -30000000.5), new Vec3(0.5, 64, -30000001.5));
    expect(agents).toHaveLength(1);
    expect(agents[0]).not.toHaveProperty('pos');
  });
});
