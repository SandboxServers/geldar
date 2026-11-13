import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { GIVE_REACH } from '../actions/give.ts';
import { agentStance } from './entities.ts';

const HERE = new Vec3(0.5, 64, 0.5);

/** The stance of one agent standing at `position`, the Body at HERE; distance is the straight line. */
function stanceAt(position: Vec3) {
  return agentStance(HERE, position, HERE.distanceTo(position));
}

describe('another agent: vertical and in_reach', () => {
  it('says below when the agent stands more than one block lower', () => {
    expect(stanceAt(new Vec3(2.5, 62, 0.5))).toEqual({ vertical: 'below', in_reach: true });
  });

  it('says above when the agent stands more than one block higher', () => {
    expect(stanceAt(new Vec3(1.5, 66, 0.5))).toEqual({ vertical: 'above', in_reach: true });
  });

  it('says level for one block up or down, and for the same height', () => {
    expect(stanceAt(new Vec3(2.5, 63, 0.5)).vertical).toBe('level');
    expect(stanceAt(new Vec3(2.5, 65, 0.5)).vertical).toBe('level');
    expect(stanceAt(new Vec3(2.5, 64, 0.5)).vertical).toBe('level');
  });

  it('reads in_reach from the straight-line distance, inclusive of GIVE_REACH', () => {
    expect(stanceAt(new Vec3(0.5 + GIVE_REACH, 64, 0.5)).in_reach).toBe(true);
    expect(stanceAt(new Vec3(0.5 + GIVE_REACH + 0.5, 64, 0.5)).in_reach).toBe(false);
  });

  it('reads a diagonal distance: a vertical gap pushes an agent out of reach', () => {
    // 2 blocks lower and 2.5 across: about 3.2 blocks, beyond GIVE_REACH.
    expect(stanceAt(new Vec3(3.0, 62, 0.5))).toEqual({ vertical: 'below', in_reach: false });
  });

  it('reads the sign of the height difference on the other side too', () => {
    expect(stanceAt(new Vec3(0.5, 60, 0.5))).toEqual({ vertical: 'below', in_reach: false });
    expect(stanceAt(new Vec3(0.5, 70, 0.5))).toEqual({ vertical: 'above', in_reach: false });
  });
});
