-- Migration 0066 (T-08): behaviour of the events trace id. Run after check-schema.sql and the
-- migrations through 0066. Fixtures are written by the superuser; the privilege checks use has_*_privilege.
-- Every probe rolls back, so the file can run twice on the same database.
DO $event_trace$
DECLARE
  step TEXT;
  col_nullable TEXT;
  col_default TEXT;
BEGIN
  step := 'columns: events.trace_id exists, is nullable and has no default';
  SELECT is_nullable, column_default INTO col_nullable, col_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'trace_id';
  IF col_nullable IS DISTINCT FROM 'YES' OR col_default IS NOT NULL THEN
    RAISE EXCEPTION 'event-trace: % failed (events.trace_id missing, NOT NULL or defaulted)', step;
  END IF;

  step := 'privilege: geldar_glass cannot read events.trace_id';
  IF has_column_privilege('geldar_glass', 'events', 'trace_id', 'SELECT') THEN
    RAISE EXCEPTION 'event-trace: % failed', step;
  END IF;

  step := 'privilege: geldar_mcp cannot read events.trace_id';
  IF has_column_privilege('geldar_mcp', 'events', 'trace_id', 'SELECT') THEN
    RAISE EXCEPTION 'event-trace: % failed', step;
  END IF;

  step := 'fixtures and checks (rolled back)';
  BEGIN
    step := 'untraced event: an insert without trace_id lands with NULL';
    INSERT INTO events (source_event_id, at, world_day, world_tick, type, agent_id, thinker_id, payload)
      VALUES ('ev_trace_plain', now(), 1, 200, 'sleep', NULL, NULL, '{}'::jsonb);
    IF NOT EXISTS (SELECT 1 FROM events WHERE source_event_id = 'ev_trace_plain' AND trace_id IS NULL) THEN
      RAISE EXCEPTION 'event-trace: % failed', step;
    END IF;

    step := 'traced event: a 32-hex trace id lands';
    INSERT INTO events (source_event_id, at, world_day, world_tick, type, agent_id, thinker_id, payload,
                        trace_id)
      VALUES ('ev_trace_set', now(), 1, 201, 'sleep', NULL, NULL, '{}'::jsonb,
              '4bf92f3577b34da6a3ce929d0e0e4736');
    IF NOT EXISTS (SELECT 1 FROM events WHERE source_event_id = 'ev_trace_set'
                   AND trace_id = '4bf92f3577b34da6a3ce929d0e0e4736') THEN
      RAISE EXCEPTION 'event-trace: % failed', step;
    END IF;

    step := 'idempotent: a redelivered event keeps its first trace id';
    INSERT INTO events (source_event_id, at, world_day, world_tick, type, agent_id, thinker_id, payload,
                        trace_id)
      VALUES ('ev_trace_set', now(), 1, 201, 'sleep', NULL, NULL, '{}'::jsonb, 'ffffffffffffffffffffffffffffffff')
      ON CONFLICT (source_event_id) DO NOTHING;
    IF NOT EXISTS (SELECT 1 FROM events WHERE source_event_id = 'ev_trace_set'
                   AND trace_id = '4bf92f3577b34da6a3ce929d0e0e4736') THEN
      RAISE EXCEPTION 'event-trace: % failed', step;
    END IF;

    RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'PR001';
  EXCEPTION WHEN SQLSTATE 'PR001' THEN NULL;
  END;
  RAISE NOTICE 'schema check passed: the events trace id';
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'schema check (event trace, %): %', step, SQLERRM;
END
$event_trace$;
