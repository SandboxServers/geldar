import { describe, expect, it } from 'vitest';
import { parseExpected, parseRange } from '../src/expected.ts';

describe('parseExpected', () => {
  it('reads a JSON array, sorted', () => {
    expect(parseExpected('[25570, 25565]')).toEqual([25565, 25570]);
  });

  it('reads whitespace or comma separated numbers', () => {
    expect(parseExpected('25565\n25570, 8080')).toEqual([8080, 25565, 25570]);
  });

  it('accepts an empty JSON array for no open ports', () => {
    expect(parseExpected('[]')).toEqual([]);
  });

  it('refuses an empty file, so a missing list cannot pass by accident', () => {
    expect(() => parseExpected('  \n')).toThrow(/empty/);
  });

  it('refuses a duplicate port', () => {
    expect(() => parseExpected('25565 25565')).toThrow(/duplicate/);
  });

  it('refuses port 0 and port 65536', () => {
    expect(() => parseExpected('[0]')).toThrow(/outside/);
    expect(() => parseExpected('[65536]')).toThrow(/outside/);
  });

  it('refuses text that is not a port', () => {
    expect(() => parseExpected('25565 abc')).toThrow(/not a port number/);
  });

  it('refuses a JSON value that is not an array of numbers', () => {
    expect(() => parseExpected('{"ports": [25565]}')).toThrow(/array/);
    expect(() => parseExpected('["25565"]')).toThrow(/array/);
  });
});

describe('parseRange', () => {
  it('reads the whole TCP range, both ends inclusive', () => {
    expect(parseRange('1-65535')).toEqual({ low: 1, high: 65535 });
  });

  it('reads a single-port range', () => {
    expect(parseRange('25565-25565')).toEqual({ low: 25565, high: 25565 });
  });

  it('refuses a reversed range', () => {
    expect(() => parseRange('25570-25560')).toThrow(/LOW above HIGH/);
  });

  it('refuses a range outside 1 to 65535', () => {
    expect(() => parseRange('0-10')).toThrow(/outside/);
    expect(() => parseRange('1-65536')).toThrow(/outside/);
  });

  it('refuses a text that is not a range', () => {
    expect(() => parseRange('25565')).toThrow(/LOW-HIGH/);
  });
});
