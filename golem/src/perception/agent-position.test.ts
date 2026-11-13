import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { GIVE_REACH } from '../actions/give.ts';
import { agentNote } from './entities.ts';

const HERE = new Vec3(0.5, 64, 0.5);

/** The note for one agent standing at `position`, the Body at HERE; distance is the straight line. */
function noteAt(position: Vec3): string {
  return agentNote(HERE, position, HERE.distanceTo(position));
}

describe('another agent: above, below and in reach', () => {
  it('says below when the agent stands more than one block lower', () => {
    expect(noteAt(new Vec3(2.5, 62, 0.5))).toBe('unknown, below, in reach');
  });

  it('says above when the agent stands more than one block higher', () => {
    expect(noteAt(new Vec3(1.5, 66, 0.5))).toBe('unknown, above, in reach');
  });

  it('says level for one block up or down, and for the same height', () => {
    expect(noteAt(new Vec3(2.5, 63, 0.5))).toBe('unknown, level, in reach');
    expect(noteAt(new Vec3(2.5, 65, 0.5))).toBe('unknown, level, in reach');
    expect(noteAt(new Vec3(2.5, 64, 0.5))).toBe('unknown, level, in reach');
  });

  it('reads reach from the straight-line distance, inclusive of GIVE_REACH', () => {
    expect(noteAt(new Vec3(0.5 + GIVE_REACH, 64, 0.5))).toBe('unknown, level, in reach');
    expect(noteAt(new Vec3(0.5 + GIVE_REACH + 0.5, 64, 0.5))).toBe('unknown, level, out of reach');
  });

  it('reads a diagonal distance: a vertical gap pushes an agent out of reach', () => {
    // 2 blocks lower and 2.5 across: about 3.2 blocks, beyond GIVE_REACH.
    expect(noteAt(new Vec3(3.0, 62, 0.5))).toBe('unknown, below, out of reach');
  });

  it('reads the sign of the height difference on the other side too', () => {
    expect(noteAt(new Vec3(0.5, 60, 0.5))).toBe('unknown, below, out of reach');
    expect(noteAt(new Vec3(0.5, 70, 0.5))).toBe('unknown, above, out of reach');
  });
});
