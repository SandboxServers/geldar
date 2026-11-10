import { describe, expect, it } from 'vitest';
import { retireSelected, selectedLife } from './retire.ts';

const SHARD = `
shard: phase0
mind:
  agent:
    username: ag_adam_01
    tier: small
`;

/** A removal fake that records the lives it was asked to retire. */
function recording() {
  const lives: string[] = [];
  return {
    lives,
    async removeLife(lifeId: string): Promise<string[]> {
      lives.push(lifeId);
      return [`registry key ${lifeId}: deleted`, `whitelist ${lifeId}: removed`];
    },
  };
}

describe('selectedLife', () => {
  it('reads mind.agent.username', () => {
    expect(selectedLife(SHARD)).toBe('ag_adam_01');
  });

  it('is null when the shard names no username, or is not YAML', () => {
    expect(selectedLife('mind:\n  agent: {}\n')).toBeNull();
    expect(selectedLife('mind:\n  agent:\n    username: "  "\n')).toBeNull();
    expect(selectedLife('mind: [unclosed')).toBeNull();
  });
});

describe('retireSelected', () => {
  it('removes the selected life once no service runs', async () => {
    const removal = recording();
    const lines = await retireSelected(SHARD, false, removal.removeLife);
    expect(removal.lives).toEqual(['ag_adam_01']);
    expect(lines).toEqual(['registry key ag_adam_01: deleted', 'whitelist ag_adam_01: removed']);
  });

  it('keeps the life while a service still runs', async () => {
    const removal = recording();
    const lines = await retireSelected(SHARD, true, removal.removeLife);
    expect(removal.lives).toEqual([]);
    expect(lines).toEqual(['life ag_adam_01 kept: a service is still running']);
  });

  it('removes nothing when there is no shard file or no selected life', async () => {
    const removal = recording();
    expect(await retireSelected(null, false, removal.removeLife)).toHaveLength(1);
    expect(await retireSelected('shard: phase0\n', false, removal.removeLife)).toHaveLength(1);
    expect(removal.lives).toEqual([]);
  });
});
