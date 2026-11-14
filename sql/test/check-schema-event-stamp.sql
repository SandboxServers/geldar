-- Migration 0037 (GX-01a): behaviour of the harness and model stamp. Run after check-schema.sql and the
-- migrations through 0037. Fixtures are written by the superuser; the privilege checks use has_*_privilege.
-- Every probe rolls back, so the file can run twice on the same database.
DO $event_stamp$
DECLARE
  step TEXT;
  refused BOOLEAN;
  col_nullable TEXT;
BEGIN
  step := 'columns: events.harness and events.model exist and are nullable';
  SELECT is_nullable INTO col_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'harness';
  IF col_nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION 'event-stamp: % failed (events.harness missing or NOT NULL)', step;
  END IF;
  SELECT is_nullable INTO col_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'model';
  IF col_nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION 'event-stamp: % failed (events.model missing or NOT NULL)', step;
  END IF;

  step := 'privilege: geldar_glass cannot read events.harness or events.model';
  IF has_column_privilege('geldar_glass', 'events', 'harness', 'SELECT')
     OR has_column_privilege('geldar_glass', 'events', 'model', 'SELECT') THEN
    RAISE EXCEPTION 'event-stamp: % failed', step;
  END IF;

  step := 'privilege: geldar_mcp cannot read events.harness or events.model';
  IF has_column_privilege('geldar_mcp', 'events', 'harness', 'SELECT')
     OR has_column_privilege('geldar_mcp', 'events', 'model', 'SELECT') THEN
    RAISE EXCEPTION 'event-stamp: % failed', step;
  END IF;

  step := 'privilege: geldar_mcp can read agents.declared_model';
  IF NOT has_column_privilege('geldar_mcp', 'agents', 'declared_model', 'SELECT') THEN
    RAISE EXCEPTION 'event-stamp: % failed', step;
  END IF;

  step := 'fixtures and checks (rolled back)';
  BEGIN
    step := 'unstamped event: an insert without harness or model lands with NULLs';
    INSERT INTO events (source_event_id, at, world_day, world_tick, type, agent_id, thinker_id, payload)
      VALUES ('ev_stamp_plain', now(), 1, 100, 'sleep', NULL, NULL, '{}'::jsonb);
    IF NOT EXISTS (SELECT 1 FROM events WHERE source_event_id = 'ev_stamp_plain'
                   AND harness IS NULL AND model IS NULL) THEN
      RAISE EXCEPTION 'event-stamp: % failed', step;
    END IF;

    step := 'stamped event: harness and model land';
    INSERT INTO events (source_event_id, at, world_day, world_tick, type, agent_id, thinker_id, payload,
                        harness, model)
      VALUES ('ev_stamp_claude', now(), 1, 101, 'sleep', NULL, NULL, '{}'::jsonb,
              'claude', 'claude-sonnet-5.5');
    IF NOT EXISTS (SELECT 1 FROM events WHERE source_event_id = 'ev_stamp_claude'
                   AND harness = 'claude' AND model = 'claude-sonnet-5.5') THEN
      RAISE EXCEPTION 'event-stamp: % failed', step;
    END IF;

    step := 'check: a bad harness (Claude) is refused';
    refused := false;
    BEGIN
      INSERT INTO events (source_event_id, at, world_day, world_tick, type, agent_id, thinker_id, payload,
                          harness)
        VALUES ('ev_stamp_bad', now(), 1, 102, 'sleep', NULL, NULL, '{}'::jsonb, 'Claude');
    EXCEPTION WHEN check_violation THEN
      refused := true;
    END;
    IF NOT refused THEN
      RAISE EXCEPTION 'event-stamp: % failed', step;
    END IF;

    step := 'check: an empty model is refused';
    refused := false;
    BEGIN
      INSERT INTO events (source_event_id, at, world_day, world_tick, type, agent_id, thinker_id, payload,
                          model)
        VALUES ('ev_stamp_empty', now(), 1, 103, 'sleep', NULL, NULL, '{}'::jsonb, '');
    EXCEPTION WHEN check_violation THEN
      refused := true;
    END;
    IF NOT refused THEN
      RAISE EXCEPTION 'event-stamp: % failed', step;
    END IF;

    step := 'check: a 129-character model is refused';
    refused := false;
    BEGIN
      INSERT INTO events (source_event_id, at, world_day, world_tick, type, agent_id, thinker_id, payload,
                          model)
        VALUES ('ev_stamp_long', now(), 1, 104, 'sleep', NULL, NULL, '{}'::jsonb, repeat('a', 129));
    EXCEPTION WHEN check_violation THEN
      refused := true;
    END;
    IF NOT refused THEN
      RAISE EXCEPTION 'event-stamp: % failed', step;
    END IF;

    RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'PR001';
  EXCEPTION WHEN SQLSTATE 'PR001' THEN NULL;
  END;
  RAISE NOTICE 'schema check passed: the events harness and model stamp';
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'schema check (event stamp, %): %', step, SQLERRM;
END
$event_stamp$;
