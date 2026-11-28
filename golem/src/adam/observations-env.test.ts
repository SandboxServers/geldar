import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../config.ts';
import { playerBodyEnv } from '../players/body-host.ts';
import { observationsFromEnv, observationsOption } from './observations-env.ts';

describe('GELDAR_OBSERVATIONS parse (AN-50d)', () => {
  it('is off when unset, empty, or any other value', () => {
    for (const value of [undefined, '', '0', 'off', 'ON', 'true', ' 1', '1 ', 'yes']) {
      expect(observationsFromEnv(value), `value ${JSON.stringify(value)}`).toBe(false);
    }
  });

  it("is on for '1' and 'on' only", () => {
    expect(observationsFromEnv('1')).toBe(true);
    expect(observationsFromEnv('on')).toBe(true);
  });

  it('the Body env spread is empty when off and carries observations: true when on', () => {
    expect(observationsOption(undefined)).toEqual({});
    expect(Object.keys(observationsOption('0'))).toEqual([]);
    expect(observationsOption('1')).toEqual({ observations: true });
    expect(observationsOption('on')).toEqual({ observations: true });
  });
});

describe('GELDAR_OBSERVATIONS reaches the Body env in the player host (AN-50d)', () => {
  const base = {
    config: {} as Parameters<typeof playerBodyEnv>[0]['config'],
    kv: {} as Parameters<typeof playerBodyEnv>[0]['kv'],
    publisher: { publish: async () => undefined },
    nc: {} as Parameters<typeof playerBodyEnv>[0]['nc'],
    server: { serve: () => () => undefined },
    log: () => undefined,
  } as unknown as Omit<Parameters<typeof playerBodyEnv>[0], 'observations'>;

  it('absent or false leaves the key off the env, as today', () => {
    expect(Object.hasOwn(playerBodyEnv(base), 'observations')).toBe(false);
    expect(Object.hasOwn(playerBodyEnv({ ...base, observations: false }), 'observations')).toBe(
      false,
    );
  });

  it('true sets observations on the Body env', () => {
    expect(playerBodyEnv({ ...base, observations: true }).observations).toBe(true);
  });
});

describe('GELDAR_OBSERVATIONS is forwarded by the entry points and compose (AN-50d)', () => {
  it('the Adam Body and the player host read the variable through the parse', () => {
    const adam = readFileSync(join(repoRoot(), 'golem/src/adam/main.ts'), 'utf8');
    expect(adam).toContain('...observationsOption(process.env.GELDAR_OBSERVATIONS)');
    const player = readFileSync(join(repoRoot(), 'golem/src/players/main.ts'), 'utf8');
    expect(player).toContain('observations: observationsFromEnv(env.GELDAR_OBSERVATIONS)');
  });

  it('colo.yml passes the variable through empty to golem-body and players-host, and sets no value', () => {
    const colo = readFileSync(join(repoRoot(), 'compose/colo.yml'), 'utf8');
    const passThrough = 'GELDAR_OBSERVATIONS: "${GELDAR_OBSERVATIONS:-}"';
    expect(colo.split(passThrough).length - 1).toBe(2);
    expect(colo).not.toMatch(/GELDAR_OBSERVATIONS:\s*"?(1|on)"?\s*$/m);
  });
});
