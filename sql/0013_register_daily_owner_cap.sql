-- Migration 0013 (decision 0135, pass-4 F28): the daily new-owner cap is enforced by the database.
-- register_create_owner counts the identities created in the last 24 hours, under a transaction advisory
-- lock so two sign-ups cannot both pass the count, and refuses the 11th. The cap is a constant here
-- (10), as the start credits are in register_create_player. Body of 0012 otherwise unchanged; the
-- grants of 0011 stay on the function (CREATE OR REPLACE keeps them).
CREATE OR REPLACE FUNCTION register_create_owner(
  p_identity_hash BYTEA,
  p_provider TEXT,
  p_owner_id TEXT,
  p_display TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $owner$
DECLARE
  daily_cap CONSTANT INT := 10;
BEGIN
  IF p_provider NOT IN ('github', 'discord') THEN
    RAISE EXCEPTION 'register_create_owner: unknown provider' USING ERRCODE = '22023';
  END IF;
  IF p_owner_id !~ '^reg-[a-z0-9-]{1,36}$' THEN
    RAISE EXCEPTION 'register_create_owner: bad owner id' USING ERRCODE = '22023';
  END IF;
  IF p_display IS NULL OR char_length(p_display) > 100 THEN
    RAISE EXCEPTION 'register_create_owner: bad display' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('register_create_owner', 0));
  IF (SELECT count(*) FROM public.mcp_identities i WHERE i.created_at >= now() - interval '24 hours')
     >= daily_cap THEN
    RAISE EXCEPTION 'register_create_owner: the daily new-owner cap of % is reached', daily_cap
      USING ERRCODE = '54000';
  END IF;
  INSERT INTO public.mcp_owners (owner_id, display) VALUES (p_owner_id, p_display);
  INSERT INTO public.mcp_identities (identity_hash, provider, owner_id)
    VALUES (p_identity_hash, p_provider, p_owner_id);
END
$owner$;

INSERT INTO schema_migrations (version) VALUES ('0013') ON CONFLICT DO NOTHING;
