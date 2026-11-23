import { afterEach, describe, expect, it } from 'vitest';
import { agentPageOf, MAX_LIMIT, pageAgents } from './agent-page.ts';
import { setAliases } from './alias.ts';
import { listAgents, listThoughts, type Row, type SqlClient } from './query.ts';

afterEach(() => setAliases(new Map()));

/** A fake client that answers with the rows it was given and records the parameters it was sent. */
function db(rows: Row[], sent: unknown[][] = []): SqlClient {
  return {
    query: async (_text: string, values: unknown[]) => {
      sent.push(values);
      return { rows };
    },
  };
}

const row = (agent_id: string, name: string, extra: Row = {}): Row => ({
  agent_id,
  name,
  mode: 'headless',
  ...extra,
});
const page = (query: string) => agentPageOf(new URLSearchParams(query));

describe('the agents search and sort', () => {
  it('finds an aliased agent by its alias and never by its stored name', async () => {
    setAliases(new Map([['ag_1', 'Ada']]));
    const rows = await listAgents(db([row('ag_1', 'Secret Name')]));
    expect(pageAgents(rows, page('q=ada'))).toEqual({
      agents: [row('ag_1', 'Ada')],
      total: 1,
    });
    expect(pageAgents(rows, page('q=secret'))).toEqual({ agents: [], total: 0 });
  });

  it('matches case-insensitively as a plain substring, never as a pattern', () => {
    const rows = [row('a', 'Wren'), row('b', 'Tess'), row('c', 'a.*b')];
    expect(pageAgents(rows, page('q=WRE')).total).toBe(1);
    expect(pageAgents(rows, page('q=.*')).agents.map((r) => r.agent_id)).toEqual(['c']);
  });

  it('cuts a search to 64 characters', () => {
    const long = 'x'.repeat(100);
    expect(page(`q=${long}`).q).toBe('x'.repeat(64));
  });

  it('sorts by name without regard to case, and by latest activity with no-activity agents last', () => {
    const rows = [
      row('a', 'bob', { last_active: '2026-01-01T00:00:00Z' }),
      row('b', 'Ann', { last_active: null }),
      row('c', 'cy', { last_active: '2026-03-01T00:00:00Z' }),
    ];
    expect(pageAgents(rows, page('')).agents.map((r) => r.name)).toEqual(['Ann', 'bob', 'cy']);
    const latest = pageAgents(rows, page('sort=latest'));
    expect(latest.agents.map((r) => r.name)).toEqual(['cy', 'bob', 'Ann']);
    expect(latest.agents[0]).not.toHaveProperty('last_active');
  });

  it('pages in code and counts only the matches, not the page', () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(`ag_${i}`, `n${i}`));
    const second = pageAgents(rows, page('limit=2&offset=2'));
    expect(second.agents.map((r) => r.agent_id)).toEqual(['ag_2', 'ag_3']);
    expect(second.total).toBe(5);
    expect(pageAgents(rows, page('q=n4&limit=2')).total).toBe(1);
    expect(pageAgents(rows, page('offset=9')).agents).toEqual([]);
  });

  it('caps the limit and falls back to the defaults on bad values', () => {
    expect(page('limit=0').limit).toBe(1);
    expect(page('limit=99999').limit).toBe(MAX_LIMIT);
    expect(page('limit=x&offset=-1')).toMatchObject({ limit: MAX_LIMIT, offset: 0, sort: 'name' });
    expect(page('sort=drop').sort).toBe('name');
  });

  it('asks for the activity time only for the latest sort, and sends it only in the sort', async () => {
    const sent: unknown[][] = [];
    const delayed = { shownUntil: '2026-01-01T00:00:00Z', showLivingSovereign: false };
    await listAgents(db([], sent), delayed, { activity: true });
    await listAgents(db([], sent), delayed);
    expect(sent[0]).toEqual([false, [], '2026-01-01T00:00:00Z']);
    expect(sent[1]).toEqual([false, []]);
  });

  it('the activity sort reads only the thoughts the thought listing shows (same sovereign and delay clauses)', async () => {
    // A sovereign agent's hidden thoughts must not count: the sort's newest-thought subquery carries the
    // thought listing's two visibility clauses word for word (only the parameter numbers differ).
    const texts: string[] = [];
    const recording = (): SqlClient => ({
      query: async (text: string) => {
        texts.push(text);
        return { rows: [] };
      },
    });
    const delayed = { shownUntil: '2026-01-01T00:00:00Z', showLivingSovereign: false };
    await listThoughts(recording(), { limit: 10 }, delayed);
    await listAgents(recording(), delayed, { activity: true });
    const [thoughtSql, activitySql] = texts.map((text) => text.replace(/\s+/g, ' ').replace(/\$\d+/g, '$P'));
    const clauses = [
      "a.mode IS DISTINCT FROM 'sovereign' OR a.died_at IS NOT NULL OR a.thoughts_delayed_public OR a.agent_id = ANY($P::text[])",
      't.at <= $P::timestamptz OR a.died_at IS NOT NULL OR a.agent_id = ANY($P::text[])',
    ];
    for (const clause of clauses) {
      expect(thoughtSql).toContain(clause);
      expect(activitySql).toContain(clause);
    }
  });
});
