import { describe, expect, it } from 'vitest';
import { EVENTS_SQL } from '../src/db.ts';

/** The events columns the loader may name: the grant to geldar_glass covers these and not payload. */
const ALLOWED_EVENT_COLUMNS = [
  'type',
  'agent_id',
  'world_day',
  'world_tick',
  'at',
  'source_event_id',
];
const SQL_WORDS = ['select', 'from', 'where', 'and', 'in', 'order', 'by'];

/** Every bare identifier in the statement, with string literals and $n parameters removed. */
function identifiers(sql: string): string[] {
  const bare = sql.replace(/'[^']*'/g, ' ').replace(/\$\d+/g, ' ');
  return [...bare.matchAll(/[a-z_][a-z0-9_]*/gi)].map((m) => m[0].toLowerCase());
}

describe('the loader reads events only through the granted columns', () => {
  it('the events query never names payload', () => {
    expect(EVENTS_SQL).not.toMatch(/payload/i);
  });

  it('every identifier in the events query is a granted column or a SQL keyword', () => {
    const allowed = new Set([...ALLOWED_EVENT_COLUMNS, ...SQL_WORDS, 'events']);
    const extra = identifiers(EVENTS_SQL).filter((id) => !allowed.has(id));
    expect(extra).toEqual([]);
  });

  it('the events query reads the table with the grant it needs', () => {
    expect(identifiers(EVENTS_SQL)).toContain('agent_id');
    expect(EVENTS_SQL).toMatch(/FROM events\b/);
  });
});
