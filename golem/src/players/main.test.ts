import { describe, expect, it } from 'vitest';
import { playerIdFromArgs } from './main.ts';

describe('playerIdFromArgs', () => {
  it('reads the id after --player', () => {
    expect(playerIdFromArgs(['--player', 'ag-jason-01'])).toBe('ag-jason-01');
    expect(playerIdFromArgs(['x', '--player', 'ag-jason-01'])).toBe('ag-jason-01');
  });

  it('refuses a missing id, and a flag where the id belongs', () => {
    expect(() => playerIdFromArgs([])).toThrow(/usage: main.ts --player/);
    expect(() => playerIdFromArgs(['--player'])).toThrow(/usage/);
    expect(() => playerIdFromArgs(['--player', '--other'])).toThrow(/usage/);
  });
});
