-- Fails with RAISE EXCEPTION unless mcp_roster (migration 0024) has its shape and its checks:
-- max_agents defaults to 1 and refuses 0 and 5, owner_id must name an owner, and player_name is
-- unique in any letter case. Each probe row is rolled back by the final raise, so the check leaves no rows behind.
-- Run after the migrations, with the other check-schema files.
DO $roster$
BEGIN
  IF to_regclass('public.mcp_roster') IS NULL THEN
    RAISE EXCEPTION 'mcp_roster is missing' USING ERRCODE = 'XX000';
  END IF;

  INSERT INTO mcp_owners (owner_id, display, player_cap)
    VALUES ('roster-probe', 'roster-probe', 3);
  INSERT INTO mcp_roster (player_name, owner_id) VALUES ('RosterProbe', 'roster-probe');
  IF (SELECT max_agents FROM mcp_roster WHERE player_name = 'RosterProbe') <> 1 THEN
    RAISE EXCEPTION 'max_agents does not default to 1' USING ERRCODE = 'XX000';
  END IF;

  BEGIN
    INSERT INTO mcp_roster (player_name, owner_id, max_agents)
      VALUES ('RosterProbeFive', 'roster-probe', 5);
    RAISE EXCEPTION 'max_agents 5 was accepted' USING ERRCODE = 'XX000';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO mcp_roster (player_name, owner_id, max_agents)
      VALUES ('RosterProbeZero', 'roster-probe', 0);
    RAISE EXCEPTION 'max_agents 0 was accepted' USING ERRCODE = 'XX000';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO mcp_roster (player_name, owner_id) VALUES ('RosterProbeOrphan', 'no-such-owner');
    RAISE EXCEPTION 'a name for an unknown owner was accepted' USING ERRCODE = 'XX000';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO mcp_roster (player_name, owner_id) VALUES ('RosterProbe', 'roster-probe');
    RAISE EXCEPTION 'a duplicate name was accepted' USING ERRCODE = 'XX000';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  INSERT INTO mcp_roster (player_name, owner_id) VALUES ('Ranger', 'roster-probe');
  BEGIN
    INSERT INTO mcp_roster (player_name, owner_id) VALUES ('ranger', 'roster-probe');
    RAISE EXCEPTION 'a roster name differing only by case was accepted' USING ERRCODE = 'XX000';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'roster probe rollback';
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN NULL;
END
$roster$;
