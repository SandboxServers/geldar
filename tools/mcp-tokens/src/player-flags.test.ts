import { describe, expect, it } from 'vitest';
import { type Env, type Io, run } from './cli.ts';
import { parsePlayerFlags, setPlayerFlags } from './player-flags.ts';

/** A session that answers the operator function with one outcome and records each call. */
function session(outcome: string, calls: Array<{ text: string; values?: unknown[] | undefined }>) {
  return {
    query: async (text: string, values?: unknown[]) => {
      calls.push({ text, values });
      return { rows: [{ outcome }] };
    },
    end: async () => {},
  };
}

function io(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (line) => out.push(line), err: (line) => err.push(line) }, out, err };
}

const env = (outcome: string, calls: Array<{ text: string; values?: unknown[] | undefined }>): Env => ({
  secretDir: '/unused',
  shardFile: '/unused/phase0.yaml',
  connect: async () => session(outcome, calls),
});

describe('parsePlayerFlags', () => {
  it('reads one flag on, the other off, or both', () => {
    expect(parsePlayerFlags(['ag-x-01'], 'on', undefined)).toEqual({
      playerId: 'ag-x-01',
      flags: { publicCamera: true, thoughtsDelayedPublic: undefined },
    });
    expect(parsePlayerFlags(['ag-x-01'], undefined, 'off').flags).toEqual({
      publicCamera: undefined,
      thoughtsDelayedPublic: false,
    });
    expect(parsePlayerFlags(['ag-x-01'], 'off', 'on').flags).toEqual({
      publicCamera: false,
      thoughtsDelayedPublic: true,
    });
  });

  it('refuses a missing or extra player id', () => {
    expect(() => parsePlayerFlags([], 'on', undefined)).toThrow(/usage: player flags/);
    expect(() => parsePlayerFlags([''], 'on', undefined)).toThrow(/usage: player flags/);
    expect(() => parsePlayerFlags(['ag-x-01', 'ag-x-02'], 'on', undefined)).toThrow(
      /usage: player flags/,
    );
  });

  it('refuses a call with no flag at all', () => {
    expect(() => parsePlayerFlags(['ag-x-01'], undefined, undefined)).toThrow(
      /give --public-camera, --thoughts-delayed-public or both/,
    );
  });

  it('refuses any value other than on or off, and names the flag', () => {
    expect(() => parsePlayerFlags(['ag-x-01'], 'yes', undefined)).toThrow(
      /--public-camera takes on or off, not "yes"/,
    );
    expect(() => parsePlayerFlags(['ag-x-01'], undefined, '')).toThrow(
      /--thoughts-delayed-public takes on or off/,
    );
  });
});

describe('setPlayerFlags', () => {
  it('sends the function once with null for a flag left alone', async () => {
    const calls: Array<{ text: string; values?: unknown[] | undefined }> = [];
    const result = await setPlayerFlags(session('ok', calls), 'ag-x-01', {
      publicCamera: true,
    });
    expect(calls).toEqual([
      {
        text: 'SELECT operator_set_player_flags($1, $2, $3) AS outcome',
        values: ['ag-x-01', true, null],
      },
    ]);
    expect(result).toEqual({
      exit: 0,
      line: 'player ag-x-01: public camera on, delayed public thoughts unchanged',
    });
  });

  it('maps ok with both flags off to exit 0 and says off', async () => {
    const result = await setPlayerFlags(session('ok', []), 'ag-x-01', {
      publicCamera: false,
      thoughtsDelayedPublic: false,
    });
    expect(result).toEqual({
      exit: 0,
      line: 'player ag-x-01: public camera off, delayed public thoughts off',
    });
  });

  it('maps too-soon to exit 3 with a retry message, and still made the call (the audit row is written there)', async () => {
    const calls: Array<{ text: string; values?: unknown[] | undefined }> = [];
    const result = await setPlayerFlags(session('too-soon', calls), 'ag-x-01', {
      thoughtsDelayedPublic: true,
    });
    expect(calls).toHaveLength(1);
    expect(result.exit).toBe(3);
    expect(result.line).toMatch(/less than 10 seconds ago; nothing changed\. Wait 10 seconds/);
  });

  it('maps unknown-player and retired-player to exit 4 and nothing changed', async () => {
    const unknown = await setPlayerFlags(session('unknown-player', []), 'ag-x-99', {
      publicCamera: true,
    });
    expect(unknown).toEqual({ exit: 4, line: 'player ag-x-99: no such player; nothing changed' });
    const retired = await setPlayerFlags(session('retired-player', []), 'ag-x-02', {
      publicCamera: true,
    });
    expect(retired).toEqual({
      exit: 4,
      line: 'player ag-x-02: the player is retired; nothing changed',
    });
  });

  it('maps no-flags to exit 2 and an unknown code to exit 1', async () => {
    expect((await setPlayerFlags(session('no-flags', []), 'ag-x-01', {})).exit).toBe(2);
    const odd = await setPlayerFlags(session('surprise', []), 'ag-x-01', { publicCamera: true });
    expect(odd).toEqual({ exit: 1, line: 'player ag-x-01: unexpected outcome "surprise"' });
  });
});

describe('player flags on the command line', () => {
  it('prints the ok line on stdout and exits 0', async () => {
    const calls: Array<{ text: string; values?: unknown[] | undefined }> = [];
    const h = io();
    const code = await run(
      ['player', 'flags', 'ag-x-01', '--public-camera', 'on'],
      h.io,
      env('ok', calls),
    );
    expect(code).toBe(0);
    expect(h.out).toEqual(['player ag-x-01: public camera on, delayed public thoughts unchanged']);
    expect(h.err).toEqual([]);
    expect(calls[0]?.values).toEqual(['ag-x-01', true, null]);
  });

  it('prints a refusal on stderr with its exit code, and still made the call', async () => {
    const calls: Array<{ text: string; values?: unknown[] | undefined }> = [];
    const h = io();
    const code = await run(
      ['player', 'flags', 'ag-x-01', '--thoughts-delayed-public', 'on'],
      h.io,
      env('too-soon', calls),
    );
    expect(code).toBe(3);
    expect(h.out).toEqual([]);
    expect(h.err[0]).toMatch(/nothing changed/);
    expect(calls).toHaveLength(1);
  });

  it('exits 1 with the usage line for an argument error, and never calls the database', async () => {
    const calls: Array<{ text: string; values?: unknown[] | undefined }> = [];
    const h = io();
    const code = await run(['player', 'flags', 'ag-x-01'], h.io, env('ok', calls));
    expect(code).toBe(1);
    expect(h.err[0]).toMatch(/give --public-camera/);
    expect(calls).toHaveLength(0);
  });
});
