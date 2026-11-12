import { describe, expect, it } from 'vitest';
import { ProgramRegistry } from '../program.ts';
import { createProgramRegistry, UNSUPPORTED_PROGRAMS } from './index.ts';
import { contextFor, newWorld } from './programs.fakes.ts';

describe('createProgramRegistry', () => {
  it('registers the seven programs and the unsupported names', () => {
    const registry = createProgramRegistry();
    expect(registry).toBeInstanceOf(ProgramRegistry);
    expect(registry.names()).toEqual([
      'travel',
      'gather',
      'craft',
      'build',
      'rest',
      'flee',
      'follow',
      ...UNSUPPORTED_PROGRAMS,
    ]);
    expect(registry.create('travel')?.name).toBe('travel');
    expect(registry.create('mining_skill')).toBeUndefined();
  });

  it('refuses trade_wait with unsupported', async () => {
    const registry = createProgramRegistry();
    const ctx = contextFor(newWorld());
    for (const name of UNSUPPORTED_PROGRAMS) {
      const program = registry.create(name);
      await expect(program?.start({}, ctx)).rejects.toMatchObject({ reason: 'unsupported' });
      await expect(program?.resume({}, ctx)).rejects.toMatchObject({ reason: 'unsupported' });
    }
  });

  it('gives each run its own instance', () => {
    const registry = createProgramRegistry();
    expect(registry.create('gather')).not.toBe(registry.create('gather'));
  });
});
