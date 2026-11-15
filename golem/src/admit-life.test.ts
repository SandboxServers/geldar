import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AdmitDeps,
  admitLifeId,
  admitMode,
  defaultDeps,
  failureLine,
  MODE_REFUSAL,
  runAdmit,
} from './admit-life.ts';

// The whitelist commands are replaced by two spies, so the entry wiring can be checked without RCON.
const spies = vi.hoisted(() => ({ admit: vi.fn(async () => {}), remove: vi.fn(async () => {}) }));
vi.mock('./players/whitelist.ts', () => ({
  admitLifeWithConfig: spies.admit,
  removeLifeWithConfig: spies.remove,
}));

describe('admit-life: the entry wiring (BH-5a)', () => {
  beforeEach(() => {
    spies.admit.mockClear();
    spies.remove.mockClear();
  });

  it('the add wiring calls admitLifeWithConfig only', async () => {
    await defaultDeps.admit({} as never, 'ag_jason01');
    expect(spies.admit).toHaveBeenCalledWith({}, 'ag_jason01');
    expect(spies.remove).not.toHaveBeenCalled();
  });

  it('the remove wiring calls removeLifeWithConfig only', async () => {
    await defaultDeps.remove({} as never, 'ag_jason01');
    expect(spies.remove).toHaveBeenCalledWith({}, 'ag_jason01');
    expect(spies.admit).not.toHaveBeenCalled();
  });
});

describe('admit-life: the one life id from the environment', () => {
  it('accepts a managed life id of 1 to 12 lower-case letters or digits after ag_', () => {
    expect(admitLifeId({ GELDAR_ADMIT_LIFE_ID: 'ag_a' })).toBe('ag_a');
    expect(admitLifeId({ GELDAR_ADMIT_LIFE_ID: 'ag_0123456789ab' })).toBe('ag_0123456789ab');
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['upper case', 'ag_ABC'],
    ['an underscore in the id part', 'ag_a_b'],
    ['13 characters after ag_', 'ag_0123456789abc'],
    ['no ag_ prefix', 'xx_abc'],
    ['a shell metacharacter', 'ag_a;rm'],
    ['a space', 'ag_a b'],
    ['a newline', 'ag_a\n'],
  ])('refuses %s with a fixed message, without the value', (_label, value) => {
    expect(() => admitLifeId({ GELDAR_ADMIT_LIFE_ID: value })).toThrow(
      'GELDAR_ADMIT_LIFE_ID is not a managed life id',
    );
  });

  it('ignores every other variable: the id is the only input', () => {
    expect(() =>
      admitLifeId({ GELDAR_ADMIT_LIFE_ID: 'nope', GELDAR_RCON_PASSWORD_FILE: '/run/secrets/rcon' }),
    ).toThrow();
  });
});

describe('admit-life: the mode from the environment (BH-5a)', () => {
  it('accepts exactly add and remove', () => {
    expect(admitMode({ GELDAR_ADMIT_MODE: 'add' })).toBe('add');
    expect(admitMode({ GELDAR_ADMIT_MODE: 'remove' })).toBe('remove');
  });

  it('refuses a missing mode: the default is refusal, not add', () => {
    expect(() => admitMode({})).toThrow(MODE_REFUSAL);
    expect(() => admitMode({ GELDAR_ADMIT_MODE: undefined })).toThrow(MODE_REFUSAL);
  });

  it.each(['', 'ADD', 'Remove', ' add', 'add ', 'add,remove', 'op', 'whitelist remove x', 'stop'])(
    'refuses the unknown mode %j with the fixed message',
    (value) => {
      let message = '';
      try {
        admitMode({ GELDAR_ADMIT_MODE: value });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toBe(MODE_REFUSAL);
    },
  );
});

function fakeDeps(calls: string[], failWith?: Error): AdmitDeps {
  const stack = { fake: true } as unknown as ReturnType<AdmitDeps['loadConfig']>;
  return {
    loadConfig: () => stack,
    admit: async (_cfg, id) => {
      calls.push(`admit ${id}`);
      if (failWith) throw failWith;
    },
    remove: async (_cfg, id) => {
      calls.push(`remove ${id}`);
      if (failWith) throw failWith;
    },
  };
}

describe('admit-life: the dispatch (BH-5a)', () => {
  const env = { GELDAR_ADMIT_LIFE_ID: 'ag_jason01', GELDAR_ADMIT_MODE: '' };

  it('add calls admitLifeWithConfig only, and nothing else', async () => {
    const calls: string[] = [];
    const line = await runAdmit({ ...env, GELDAR_ADMIT_MODE: 'add' }, fakeDeps(calls));
    expect(calls).toEqual(['admit ag_jason01']);
    expect(line).toBe('admit-life: ag_jason01 admitted');
  });

  it('remove calls removeLifeWithConfig only, and nothing else', async () => {
    const calls: string[] = [];
    const line = await runAdmit({ ...env, GELDAR_ADMIT_MODE: 'remove' }, fakeDeps(calls));
    expect(calls).toEqual(['remove ag_jason01']);
    expect(line).toBe('admit-life: ag_jason01 removed');
  });

  it('a missing mode connects to nothing: the config is not read and no command is sent', async () => {
    const calls: string[] = [];
    let loaded = false;
    const deps = fakeDeps(calls);
    deps.loadConfig = () => {
      loaded = true;
      return {} as ReturnType<AdmitDeps['loadConfig']>;
    };
    await expect(runAdmit({ GELDAR_ADMIT_LIFE_ID: 'ag_jason01' }, deps)).rejects.toThrow(
      MODE_REFUSAL,
    );
    expect(calls).toEqual([]);
    expect(loaded).toBe(false);
  });

  it.each(['', 'ADD', 'Remove', 'op'])('an unknown mode %j sends no command', async (mode) => {
    const calls: string[] = [];
    await expect(runAdmit({ ...env, GELDAR_ADMIT_MODE: mode }, fakeDeps(calls))).rejects.toThrow(
      MODE_REFUSAL,
    );
    expect(calls).toEqual([]);
  });

  it('a failed command yields the fixed failure line, and the RCON error text is not printed', async () => {
    const secret = 'rcon-secret-hunter2';
    const calls: string[] = [];
    const failing = fakeDeps(calls, new Error(`RCON refused: ${secret}`));
    const error = await runAdmit({ ...env, GELDAR_ADMIT_MODE: 'add' }, failing).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    const printed = failureLine(error);
    expect(printed).toBe('admit-life: admission or removal failed');
    expect(printed).not.toContain(secret);
  });

  it('the refusal line is the fixed refusal and carries no value', () => {
    expect(failureLine(new Error(MODE_REFUSAL))).toBe(MODE_REFUSAL);
  });
});
