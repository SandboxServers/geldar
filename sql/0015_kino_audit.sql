-- Migration 0015 (decision 0075 amendment; Kino K06): the pane audit trail, kept 90 days.
-- A row holds the SHA-256 of the login id, the agent, the pane, the mode and the time. It holds no token
-- and no name (lakitu-audit schema). Glass inserts one row per pane action and fails closed when the
-- insert fails (a pane is not opened unaudited). Glass has no UPDATE and no SELECT here; it purges by
-- calling kino_audit_purge, which deletes rows older than the retention and nothing else.

CREATE TABLE kino_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, -- an identity column needs no sequence grant: Glass holds none
  event TEXT NOT NULL CHECK (event IN ('pane_opened', 'pane_targeted', 'pane_mode_changed', 'pane_closed')),
  login_hash TEXT NOT NULL CHECK (login_hash ~ '^[0-9a-f]{64}$'),
  agent_id TEXT NOT NULL CHECK (agent_id ~ '^[a-z][a-z0-9_]{0,63}$'),
  pane_id TEXT NOT NULL CHECK (pane_id ~ '^pn_[0-9A-HJKMNP-TV-Z]{26}$'),
  mode TEXT NOT NULL CHECK (mode IN ('follow', 'orbit', 'free')),
  at TIMESTAMPTZ NOT NULL,
  stopped_at TIMESTAMPTZ,
  CHECK (stopped_at IS NULL OR event = 'pane_closed')
);
CREATE INDEX kino_audit_at_idx ON kino_audit (at);
REVOKE ALL ON kino_audit FROM PUBLIC;
GRANT INSERT ON kino_audit TO geldar_glass;

-- Rows with `at` before p_cutoff go; a row exactly at the cutoff stays. Glass computes the cutoff (now minus
-- 90 days); the function refuses a cutoff newer than 30 days ago, so a bug cannot wipe the recent trail.
CREATE FUNCTION kino_audit_purge(p_cutoff TIMESTAMPTZ)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $purge$
DECLARE
  n BIGINT;
BEGIN
  IF p_cutoff IS NULL OR p_cutoff > now() - interval '30 days' THEN
    RAISE EXCEPTION 'kino_audit_purge: cutoff too recent' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.kino_audit WHERE at < p_cutoff;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$purge$;
REVOKE ALL ON FUNCTION kino_audit_purge(TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kino_audit_purge(TIMESTAMPTZ) TO geldar_glass;

INSERT INTO schema_migrations (version) VALUES ('0015') ON CONFLICT DO NOTHING;
