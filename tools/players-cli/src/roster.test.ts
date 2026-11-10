import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkSkinPath, findPlayer, RosterError } from './roster.ts';

const SHARD = `
sovereign:
  players:
    - { player_id: ag-jason-01, life_id: ag_jason_01, name: Jason }
    - { player_id: ag-bad-01, life_id: Bad-Life, name: Odd }
`;

const REPO = join(process.cwd(), 'fixture-repo');

describe('findPlayer', () => {
  it('returns the life id the shard config names for a listed player', () => {
    expect(findPlayer(SHARD, 'ag-jason-01')).toEqual({
      playerId: 'ag-jason-01',
      lifeId: 'ag_jason_01',
      name: 'Jason',
    });
  });

  it('refuses an unknown player and a malformed player id', () => {
    expect(() => findPlayer(SHARD, 'ag-zack-01')).toThrow('no sovereign player ag-zack-01');
    expect(() => findPlayer(SHARD, '../etc')).toThrow(RosterError);
  });

  it('refuses a life id that is not a canonical bucket key', () => {
    expect(() => findPlayer(SHARD, 'ag-bad-01')).toThrow('no valid life_id');
  });

  it('refuses a config with no players list', () => {
    expect(() => findPlayer('sovereign: {}', 'ag-jason-01')).toThrow('no sovereign.players list');
  });
});

describe('checkSkinPath', () => {
  it('accepts a PNG under the gitignored skins directory', () => {
    expect(checkSkinPath(join(REPO, 'skins', 'jason.png'), REPO)).toBe(
      join(REPO, 'skins', 'jason.png'),
    );
  });

  it('accepts a PNG outside the repo entirely', () => {
    const outside = join(REPO, '..', 'private-skins', 'jason.png');
    expect(checkSkinPath(outside, REPO)).toBe(outside);
  });

  it('refuses a PNG elsewhere in the repo, so it cannot be committed by accident', () => {
    expect(() => checkSkinPath(join(REPO, 'docs', 'jason.png'), REPO)).toThrow(
      'must be under skins/',
    );
    expect(() => checkSkinPath(join(REPO, 'skins-but-not', 'x.png'), REPO)).toThrow(
      'must be under skins/',
    );
  });

  it('refuses a PNG in a repo directory whose name starts with two dots', () => {
    expect(() => checkSkinPath(join(REPO, '..x', 'jason.png'), REPO)).toThrow(
      'must be under skins/',
    );
  });
});
