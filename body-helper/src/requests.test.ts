import { describe, expect, it } from 'vitest';
import { parseRequest } from './requests.ts';
import { rosterFromQuery } from './roster.ts';

describe('parseRequest', () => {
  it.each(['start', 'stop', 'status', 'logtail'])('accepts the verb %s', (verb) => {
    expect(parseRequest({ verb, name: 'ranger', owner: 'own-a' })).toEqual({
      ok: true,
      verb,
      name: 'ranger',
      owner: 'own-a',
    });
  });

  it.each(['exec', 'rm', 'create', '', 'START', 'start '])('refuses the verb %j', (verb) => {
    expect(parseRequest({ verb, name: 'ranger', owner: 'own-a' }).ok).toBe(false);
  });

  it.each(['ab', 'a'.repeat(17), 'bad-name', 'sp ace', ''])('refuses the name %j', (name) => {
    expect(parseRequest({ verb: 'start', name, owner: 'own-a' }).ok).toBe(false);
  });

  it.each(['image', 'mounts', 'env', 'flags', 'cmd'])('refuses an extra %s field', (field) => {
    expect(parseRequest({ verb: 'start', name: 'ranger', owner: 'own-a', [field]: 'x' }).ok).toBe(
      false,
    );
  });

  it('refuses a request that is not an object, and a missing owner', () => {
    expect(parseRequest('start').ok).toBe(false);
    expect(parseRequest(['start']).ok).toBe(false);
    expect(parseRequest({ verb: 'start', name: 'ranger' }).ok).toBe(false);
  });
});

describe('rosterFromQuery', () => {
  it('asks the definer function for the display name and reads no table', async () => {
    const calls: Array<{ sql: string; values: readonly string[] }> = [];
    const roster = rosterFromQuery(async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [{ name: 'Ranger' }] };
    });
    expect(await roster.displayName('own-a', 'ranger')).toBe('Ranger');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain('supervisor_player_display_name');
    expect(calls[0]?.sql).not.toMatch(/mcp_roster|mcp_players/);
    expect(calls[0]?.values).toEqual(['own-a', 'ranger']);
  });

  it('gives null when the name is not on the roster', async () => {
    expect(await rosterFromQuery(async () => ({ rows: [] })).displayName('own-a', 'x')).toBeNull();
    expect(
      await rosterFromQuery(async () => ({ rows: [{ name: null }] })).displayName('own-a', 'x'),
    ).toBeNull();
  });
});
