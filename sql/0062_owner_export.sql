-- Migration 0062 (C7-09b, owner data export): register_owner_export(p_identity_hash) returns the owner's own rows as one
-- JSON document, or NULL when the hash has no owner (unknown hash, or a banned identity whose owner link is gone).
-- Additive: no table and no existing function is changed. The owner is resolved from mcp_identities by the identity
-- hash (an exact match on the 32 bytes, never a prefix). Every other read is scoped by that owner: the players and
-- tokens by owner_id, the lives by the same derivation 0040 uses (agents.owner plus mcp_players.owner_id), and the
-- per-life records by those lives. There is no unfiltered select.
--
-- Output (format 'geldar-owner-export/1'): exported_at, owner (display_name, player_cap), identity (provider,
-- created_at), players, tokens (no token_hash and no secret), lives (no game account), records (thoughts and
-- mcp_journal rows in time order, each table capped at 20000 rows per export across the owner's lives, with a
-- truncated flag per table; counts per life for the other per-life tables that 0040 erases), and not_included.
-- The owner id, the identity hash and the token hashes never appear in the output.
--
-- Writes: none, except ONE register_audit row per successful call. Its actor is the erasure-safe hash of the owner id
-- (16 hex characters, as 0040 does), its target and detail carry no name and no id (decision 0261, ROSTER-AUTO
-- ruling). An unknown hash writes no audit row. Locks: plain SELECTs only, no lock_timeout change.
-- The 20000 cap is a literal in this function (tested by inserting 20001 rows in the check file).

CREATE OR REPLACE FUNCTION register_owner_export(p_identity_hash BYTEA)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $owner_export$
DECLARE
  who TEXT;
  ident_provider TEXT;
  ident_created TIMESTAMPTZ;
  owner_display TEXT;
  owner_cap INT;
  lives TEXT[];
  th_truncated BOOLEAN;
  jr_truncated BOOLEAN;
  out JSONB;
BEGIN
  SELECT i.owner_id, i.provider, i.created_at INTO who, ident_provider, ident_created
    FROM public.mcp_identities i
    WHERE i.identity_hash = p_identity_hash AND i.owner_id IS NOT NULL;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT o.display, o.player_cap INTO owner_display, owner_cap
    FROM public.mcp_owners o WHERE o.owner_id = who;

  -- every life of the owner, dead or alive (the same derivation as register_account_delete in 0040)
  lives := ARRAY(SELECT a.agent_id FROM public.agents a WHERE a.owner = who
                 UNION
                 SELECT p.life_id FROM public.mcp_players p WHERE p.owner_id = who);

  -- the cap: a row past the 20000th in time order means the table is truncated
  th_truncated := EXISTS (SELECT 1 FROM public.thoughts x WHERE x.life_id = ANY (lives)
                          ORDER BY x.at, x.thought_id OFFSET 20000);
  jr_truncated := EXISTS (SELECT 1 FROM public.mcp_journal x WHERE x.life_id = ANY (lives)
                          ORDER BY x.at, x.id OFFSET 20000);

  out := jsonb_build_object(
    'format', 'geldar-owner-export/1',
    'exported_at', now(),
    'owner', jsonb_build_object('display_name', owner_display, 'player_cap', owner_cap),
    'identity', jsonb_build_object('provider', ident_provider, 'created_at', ident_created),
    'players', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'player_id', p.player_id, 'life_id', p.life_id, 'display_name', p.display_name,
                  'harness', p.harness, 'status', p.status) ORDER BY p.player_id), '[]'::jsonb)
                FROM public.mcp_players p WHERE p.owner_id = who),
    'tokens', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'token_id', t.token_id, 'player_id', t.player_id, 'label', t.label,
                  'created_at', t.created_at, 'expires_at', t.expires_at, 'revoked_at', t.revoked_at,
                  'last_used_at', t.last_used_at) ORDER BY t.token_id), '[]'::jsonb)
               FROM public.mcp_tokens t
               JOIN public.mcp_players p ON p.player_id = t.player_id
               WHERE p.owner_id = who),
    'lives', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'life_id', a.agent_id, 'name', a.name, 'shard', a.shard, 'mode', a.mode,
                  'harness', a.harness, 'declared_model', a.declared_model, 'tier', a.tier,
                  'born_at', a.born_at, 'died_at', a.died_at, 'death_cause', a.death_cause)
                  ORDER BY a.agent_id), '[]'::jsonb)
              FROM public.agents a WHERE a.agent_id = ANY (lives)),
    'records', jsonb_build_object(
      'thoughts', jsonb_build_object('truncated', th_truncated, 'rows',
        (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.at, t.thought_id), '[]'::jsonb)
         FROM (SELECT * FROM public.thoughts x WHERE x.life_id = ANY (lives)
               ORDER BY x.at, x.thought_id LIMIT 20000) t)),
      'mcp_journal', jsonb_build_object('truncated', jr_truncated, 'rows',
        (SELECT COALESCE(jsonb_agg(to_jsonb(j) ORDER BY j.at, j.id), '[]'::jsonb)
         FROM (SELECT * FROM public.mcp_journal x WHERE x.life_id = ANY (lives)
               ORDER BY x.at, x.id LIMIT 20000) j)),
      'counts', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'life_id', l,
                  'events', (SELECT count(*) FROM public.events e WHERE e.agent_id = l OR e.thinker_id = l),
                  'memories', (SELECT count(*) FROM public.memories m WHERE m.agent_id = l),
                  'goals', (SELECT count(*) FROM public.goals g WHERE g.agent_id = l),
                  'intents', (SELECT count(*) FROM public.intents n WHERE n.life_id = l),
                  'actions', (SELECT count(*) FROM public.actions c WHERE c.life_id = l),
                  'skill_runs', (SELECT count(*) FROM public.skill_runs s WHERE s.life_id = l),
                  'skill_library', (SELECT count(*) FROM public.skill_library k WHERE k.agent_id = l),
                  'relationships', (SELECT count(*) FROM public.relationships r
                                    WHERE r.agent_id = l OR r.other_id = l),
                  'ledger', (SELECT count(*) FROM public.ledger d WHERE d.agent_id = l),
                  'votes', (SELECT count(*) FROM public.votes v WHERE v.agent_id = l),
                  'receipts', (SELECT count(*) FROM public.receipts rc WHERE rc.life_id = l),
                  'suppressed_wakeups', (SELECT count(*) FROM public.suppressed_wakeups sw WHERE sw.life_id = l),
                  'mcp_sleep_marks', (SELECT count(*) FROM public.mcp_sleep_marks ms WHERE ms.life_id = l),
                  'mcp_budget', (SELECT count(*) FROM public.mcp_budget mb WHERE mb.life_id = l),
                  'mcp_life_deaths', (SELECT count(*) FROM public.mcp_life_deaths md WHERE md.life_id = l),
                  'mcp_death_events', (SELECT count(*) FROM public.mcp_death_events me WHERE me.life_id = l),
                  'rolls', (SELECT count(*) FROM public.rolls ro WHERE ro.life_id = l),
                  'decisions', (SELECT count(*) FROM public.decisions de WHERE de.life_id = l),
                  'xp_evidence', (SELECT count(*) FROM public.xp_evidence xe WHERE xe.life_id = l),
                  'character_sheet_adoptions', (SELECT count(*) FROM public.character_sheet_adoptions ca
                                                WHERE ca.life_id = l),
                  'proficiency', (SELECT count(*) FROM public.proficiency pr WHERE pr.life_id = l),
                  'proficiency_outbox', (SELECT count(*) FROM public.proficiency_outbox po WHERE po.life_id = l)
                  ) ORDER BY l), '[]'::jsonb)
                FROM unnest(lives) AS l)
    ),
    'not_included', to_jsonb(ARRAY[
      'shared world objects kept by design: skills you authored, books, proposals and laws, which other lives depend on',
      'audit rows: the register audit (this export is one of them, hashed) and the glass login audit',
      'the ban tombstone of the identity, if one exists',
      'records of other players and other owners',
      'secrets: token values and token hashes, the identity hash and any API keys',
      'events, memories, goals, intents, actions, ledger, votes, receipts, suppressed wakeups and sheet rows of your lives: row counts only, not contents'
    ]::text[])
  );

  INSERT INTO public.register_audit (actor, action, target, outcome, admin, detail)
    VALUES (left(encode(sha256(convert_to(who, 'UTF8')), 'hex'), 16), 'owner.export', 'owner-export', 'exported',
            public.register_is_admin(who), '');
  RETURN out;
END
$owner_export$;

REVOKE ALL ON FUNCTION register_owner_export(BYTEA) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_owner_export(BYTEA) TO geldar_register;

INSERT INTO schema_migrations (version) VALUES ('0062') ON CONFLICT DO NOTHING;
