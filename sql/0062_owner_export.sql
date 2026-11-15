-- Migration 0062 (C7-09b, owner data export): register_owner_export(p_identity_hash) returns the owner's own rows as one
-- JSON document, or NULL when the hash has no owner (unknown hash, or a banned identity whose owner link is gone).
-- Additive: no table and no existing function is changed. The owner is resolved from mcp_identities by the identity
-- hash (an exact match on the 32 bytes, never a prefix). Every other read is scoped by that owner: the players, tokens,
-- roster reservations and body operations by owner_id, the consent records by the owner's identities, the lives by the
-- same derivation 0040 uses (agents.owner plus mcp_players.owner_id), and the per-life records by those lives.
-- There is no unfiltered select.
--
-- Output (format 'geldar-owner-export/1'): exported_at, owner (display_name, player_cap), identity (provider,
-- created_at), players, tokens (no token_hash, no secret), roster (reserved player names, max_agents), body_ops (start
-- and restart operations: at, player_name, op), consents (terms_version, accepted_at), lives (no game account), records:
-- thoughts (an explicit column list: model_input, snapshot, raw_output and provider_usage are NOT exported) and
-- mcp_journal rows in time order, each table capped at 20000 rows and at a running budget of 100000000 bytes, with a
-- truncated flag per table computed in the same statement as its rows; per-life row counts (no contents) for the other
-- per-life tables that 0040 erases; and not_included, which names every table or column that is left out (turn_records among them).
-- The owner id, the identity hash and the token hashes never appear in the output.
-- Writes: none, except ONE register_audit row per successful call. Its actor is the erasure-safe hash of the owner id
-- (16 hex characters, as 0040 does), its target and detail carry no name and no id (decision 0261, ROSTER-AUTO
-- ruling). An unknown hash writes no audit row. Locks: plain SELECTs only, no lock_timeout change.
-- The 20000 cap and the 100000000 byte budget are literals in this function (tested in the check file).

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
  th_part JSONB;
  jr_part JSONB;
  counts JSONB;
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

  -- thoughts: one statement ranks the rows, keeps the prefix that fits the row cap and the byte budget, and sets the
  -- truncated flag from the same ranked set (one snapshot, so the flag always agrees with the rows)
  th_part := (WITH src AS (
      SELECT x.at, x.thought_id AS sort_id, jsonb_build_object(
          'thought_id', x.thought_id, 'life_id', x.life_id, 'at', x.at, 'world_day', x.world_day,
          'world_tick', x.world_tick, 'wake_reason', x.wake_reason, 'parsed', x.parsed,
          'prompt_template_version', x.prompt_template_version, 'schema_version', x.schema_version,
          'mind_version', x.mind_version, 'body_version', x.body_version, 'model_config', x.model_config,
          'thinker_id', x.thinker_id, 'effort', x.effort, 'tokens_in_estimated', x.tokens_in_estimated,
          'tokens_out_estimated', x.tokens_out_estimated, 'latency_ms', x.latency_ms,
          'credits_reserved', x.credits_reserved, 'credits_settled', x.credits_settled) AS row_json
        FROM public.thoughts x WHERE x.life_id = ANY (lives)
    ), ranked AS (
      SELECT s.at, s.sort_id, s.row_json,
             row_number() OVER w AS rn, sum(pg_column_size(s.row_json)) OVER w AS run
        FROM src s WINDOW w AS (ORDER BY s.at, s.sort_id)
    ), kept AS (
      SELECT k.* FROM ranked k WHERE k.rn <= 20000 AND k.run <= 100000000
    )
    SELECT jsonb_build_object(
      'truncated', (SELECT count(*) FROM kept) < (SELECT count(*) FROM ranked),
      'rows', COALESCE((SELECT jsonb_agg(k.row_json ORDER BY k.at, k.sort_id) FROM kept k), '[]'::jsonb)));

  -- mcp_journal: the same shape (text is capped at 4000 characters by the table)
  jr_part := (WITH src AS (
      SELECT x.at, x.id AS sort_id, jsonb_build_object('id', x.id, 'life_id', x.life_id, 'at', x.at,
                                                      'text', x.text) AS row_json
        FROM public.mcp_journal x WHERE x.life_id = ANY (lives)
    ), ranked AS (
      SELECT s.at, s.sort_id, s.row_json,
             row_number() OVER w AS rn, sum(pg_column_size(s.row_json)) OVER w AS run
        FROM src s WINDOW w AS (ORDER BY s.at, s.sort_id)
    ), kept AS (
      SELECT k.* FROM ranked k WHERE k.rn <= 20000 AND k.run <= 100000000
    )
    SELECT jsonb_build_object(
      'truncated', (SELECT count(*) FROM kept) < (SELECT count(*) FROM ranked),
      'rows', COALESCE((SELECT jsonb_agg(k.row_json ORDER BY k.at, k.sort_id) FROM kept k), '[]'::jsonb)));

  -- counts: one scan per table, grouped by life; a row that names two lives counts once for each of them
  counts := (WITH
    c_events AS (SELECT m.l, count(*) AS n FROM public.events e,
                   LATERAL (SELECT x AS l FROM unnest(lives) AS x WHERE x = e.agent_id OR x = e.thinker_id) m
                 WHERE e.agent_id = ANY (lives) OR e.thinker_id = ANY (lives) GROUP BY m.l),
    c_relationships AS (SELECT m.l, count(*) AS n FROM public.relationships r,
                   LATERAL (SELECT x AS l FROM unnest(lives) AS x WHERE x = r.agent_id OR x = r.other_id) m
                 WHERE r.agent_id = ANY (lives) OR r.other_id = ANY (lives) GROUP BY m.l),
    c_memories AS (SELECT x.agent_id AS l, count(*) AS n FROM public.memories x
                   WHERE x.agent_id = ANY (lives) GROUP BY x.agent_id),
    c_goals AS (SELECT x.agent_id AS l, count(*) AS n FROM public.goals x
                WHERE x.agent_id = ANY (lives) GROUP BY x.agent_id),
    c_intents AS (SELECT x.life_id AS l, count(*) AS n FROM public.intents x
                  WHERE x.life_id = ANY (lives) GROUP BY x.life_id),
    c_actions AS (SELECT x.life_id AS l, count(*) AS n FROM public.actions x
                  WHERE x.life_id = ANY (lives) GROUP BY x.life_id),
    c_skill_runs AS (SELECT x.life_id AS l, count(*) AS n FROM public.skill_runs x
                     WHERE x.life_id = ANY (lives) GROUP BY x.life_id),
    c_skill_library AS (SELECT x.agent_id AS l, count(*) AS n FROM public.skill_library x
                        WHERE x.agent_id = ANY (lives) GROUP BY x.agent_id),
    c_ledger AS (SELECT x.agent_id AS l, count(*) AS n FROM public.ledger x
                 WHERE x.agent_id = ANY (lives) GROUP BY x.agent_id),
    c_votes AS (SELECT x.agent_id AS l, count(*) AS n FROM public.votes x
                WHERE x.agent_id = ANY (lives) GROUP BY x.agent_id),
    c_receipts AS (SELECT x.life_id AS l, count(*) AS n FROM public.receipts x
                   WHERE x.life_id = ANY (lives) GROUP BY x.life_id),
    c_suppressed_wakeups AS (SELECT x.life_id AS l, count(*) AS n FROM public.suppressed_wakeups x
                             WHERE x.life_id = ANY (lives) GROUP BY x.life_id),
    c_mcp_sleep_marks AS (SELECT x.life_id AS l, count(*) AS n FROM public.mcp_sleep_marks x
                          WHERE x.life_id = ANY (lives) GROUP BY x.life_id),
    c_mcp_budget AS (SELECT x.life_id AS l, count(*) AS n FROM public.mcp_budget x
                     WHERE x.life_id = ANY (lives) GROUP BY x.life_id),
    c_mcp_life_deaths AS (SELECT x.life_id AS l, count(*) AS n FROM public.mcp_life_deaths x
                          WHERE x.life_id = ANY (lives) GROUP BY x.life_id),
    c_mcp_death_events AS (SELECT x.life_id AS l, count(*) AS n FROM public.mcp_death_events x
                           WHERE x.life_id = ANY (lives) GROUP BY x.life_id),
    c_rolls AS (SELECT x.life_id AS l, count(*) AS n FROM public.rolls x
                WHERE x.life_id = ANY (lives) GROUP BY x.life_id),
    c_decisions AS (SELECT x.life_id AS l, count(*) AS n FROM public.decisions x
                    WHERE x.life_id = ANY (lives) GROUP BY x.life_id),
    c_xp_evidence AS (SELECT x.life_id AS l, count(*) AS n FROM public.xp_evidence x
                      WHERE x.life_id = ANY (lives) GROUP BY x.life_id),
    c_character_sheet_adoptions AS (SELECT x.life_id AS l, count(*) AS n FROM public.character_sheet_adoptions x
                                    WHERE x.life_id = ANY (lives) GROUP BY x.life_id),
    c_proficiency AS (SELECT x.life_id AS l, count(*) AS n FROM public.proficiency x
                      WHERE x.life_id = ANY (lives) GROUP BY x.life_id),
    c_proficiency_outbox AS (SELECT x.life_id AS l, count(*) AS n FROM public.proficiency_outbox x
                             WHERE x.life_id = ANY (lives) GROUP BY x.life_id)
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'life_id', u.l,
        'events', COALESCE(c_events.n, 0), 'memories', COALESCE(c_memories.n, 0),
        'goals', COALESCE(c_goals.n, 0), 'intents', COALESCE(c_intents.n, 0),
        'actions', COALESCE(c_actions.n, 0), 'skill_runs', COALESCE(c_skill_runs.n, 0),
        'skill_library', COALESCE(c_skill_library.n, 0), 'relationships', COALESCE(c_relationships.n, 0),
        'ledger', COALESCE(c_ledger.n, 0), 'votes', COALESCE(c_votes.n, 0),
        'receipts', COALESCE(c_receipts.n, 0), 'suppressed_wakeups', COALESCE(c_suppressed_wakeups.n, 0),
        'mcp_sleep_marks', COALESCE(c_mcp_sleep_marks.n, 0), 'mcp_budget', COALESCE(c_mcp_budget.n, 0),
        'mcp_life_deaths', COALESCE(c_mcp_life_deaths.n, 0), 'mcp_death_events', COALESCE(c_mcp_death_events.n, 0),
        'rolls', COALESCE(c_rolls.n, 0), 'decisions', COALESCE(c_decisions.n, 0),
        'xp_evidence', COALESCE(c_xp_evidence.n, 0),
        'character_sheet_adoptions', COALESCE(c_character_sheet_adoptions.n, 0),
        'proficiency', COALESCE(c_proficiency.n, 0), 'proficiency_outbox', COALESCE(c_proficiency_outbox.n, 0)
      ) ORDER BY u.l), '[]'::jsonb)
    FROM unnest(lives) AS u(l)
      LEFT JOIN c_events ON c_events.l = u.l
      LEFT JOIN c_memories ON c_memories.l = u.l
      LEFT JOIN c_goals ON c_goals.l = u.l
      LEFT JOIN c_intents ON c_intents.l = u.l
      LEFT JOIN c_actions ON c_actions.l = u.l
      LEFT JOIN c_skill_runs ON c_skill_runs.l = u.l
      LEFT JOIN c_skill_library ON c_skill_library.l = u.l
      LEFT JOIN c_relationships ON c_relationships.l = u.l
      LEFT JOIN c_ledger ON c_ledger.l = u.l
      LEFT JOIN c_votes ON c_votes.l = u.l
      LEFT JOIN c_receipts ON c_receipts.l = u.l
      LEFT JOIN c_suppressed_wakeups ON c_suppressed_wakeups.l = u.l
      LEFT JOIN c_mcp_sleep_marks ON c_mcp_sleep_marks.l = u.l
      LEFT JOIN c_mcp_budget ON c_mcp_budget.l = u.l
      LEFT JOIN c_mcp_life_deaths ON c_mcp_life_deaths.l = u.l
      LEFT JOIN c_mcp_death_events ON c_mcp_death_events.l = u.l
      LEFT JOIN c_rolls ON c_rolls.l = u.l
      LEFT JOIN c_decisions ON c_decisions.l = u.l
      LEFT JOIN c_xp_evidence ON c_xp_evidence.l = u.l
      LEFT JOIN c_character_sheet_adoptions ON c_character_sheet_adoptions.l = u.l
      LEFT JOIN c_proficiency ON c_proficiency.l = u.l
      LEFT JOIN c_proficiency_outbox ON c_proficiency_outbox.l = u.l);

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
    'roster', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'player_name', r.player_name, 'max_agents', r.max_agents, 'created_at', r.created_at)
                  ORDER BY r.player_name), '[]'::jsonb)
               FROM public.mcp_roster r WHERE r.owner_id = who),
    'body_ops', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'at', b.at, 'player_name', b.player_name, 'op', b.op) ORDER BY b.at, b.id), '[]'::jsonb)
                 FROM public.body_ops b WHERE b.owner_id = who),
    'consents', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'terms_version', c.terms_version, 'accepted_at', c.accepted_at)
                  ORDER BY c.accepted_at, c.terms_version), '[]'::jsonb)
                 FROM public.register_consents c
                 JOIN public.mcp_identities i ON i.identity_hash = c.identity_hash
                 WHERE i.owner_id = who),
    'lives', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'life_id', a.agent_id, 'name', a.name, 'shard', a.shard, 'mode', a.mode,
                  'harness', a.harness, 'declared_model', a.declared_model, 'tier', a.tier,
                  'born_at', a.born_at, 'died_at', a.died_at, 'death_cause', a.death_cause)
                  ORDER BY a.agent_id), '[]'::jsonb)
              FROM public.agents a WHERE a.agent_id = ANY (lives)),
    'records', jsonb_build_object('thoughts', th_part, 'mcp_journal', jr_part, 'counts', counts),
    'not_included', to_jsonb(ARRAY[
      'shared world objects kept by design: skills you authored, books, proposals and laws, which other lives depend on',
      'audit rows: the register audit (this export is one of them, hashed), the glass login audit and the kino audit (kino_audit)',
      'the ban tombstone of the identity, if one exists',
      'records of other players and other owners',
      'secrets: token values and token hashes, the identity hash, and API keys (owner_api_keys)',
      'login sessions (register_sessions)',
      'admin records (kino_admins)',
      'skins: skin files and their bindings',
      'thoughts columns model_input, snapshot, raw_output and provider_usage: the prompts and world snapshots carry other residents words, and the rows are bulky; the life own output is exported in the thoughts rows',
      'turn_records (0060): the per-turn model input and raw output of a kit Mind; operator-only, no owner link; erasure is deferred to GX-05c',
      'row counts only, not contents, per life, for: events, memories, goals, intents, actions, skill_runs, skill_library, relationships, ledger, votes, receipts, suppressed_wakeups, mcp_sleep_marks, mcp_budget, mcp_life_deaths, mcp_death_events, rolls, decisions, xp_evidence, character_sheet_adoptions, proficiency, proficiency_outbox'
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
