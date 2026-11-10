-- Migration 0006: the owner cap is enforced by the database (fix packet B, item 5). Before this,
-- only tools/mcp-tokens addPlayer checked mcp_owners.player_cap, so direct SQL and re-activating a
-- retired player could go over it. 0002 to 0005 are applied and are not edited. Like every
-- migration, it inserts its own schema_migrations row.

-- A player counts against its owner's cap unless it is retired. The trigger runs when a row is
-- added as a counted player, or when an existing row starts counting again: a retired row becomes
-- paused or active, or its owner changes. Pausing, resuming and retiring do not change the count.
-- The owner row is locked first, so two counted writes for one owner cannot both pass the cap.
CREATE FUNCTION mcp_enforce_owner_cap() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  owner_cap INT;
  counted INT;
BEGIN
  -- Retired rows never count. On an update, a row that already counted and keeps its owner
  -- changes nothing, so it passes without the lock. The OLD test lives here, not in a WHEN clause,
  -- because an INSERT trigger's WHEN may not reference OLD.
  IF NEW.status = 'retired' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'retired' AND OLD.owner_id = NEW.owner_id THEN
    RETURN NEW;
  END IF;
  SELECT player_cap INTO owner_cap FROM mcp_owners WHERE owner_id = NEW.owner_id FOR UPDATE;
  IF owner_cap IS NULL THEN
    RAISE EXCEPTION 'owner % does not exist', NEW.owner_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  SELECT count(*)::int INTO counted FROM mcp_players
    WHERE owner_id = NEW.owner_id AND status <> 'retired' AND player_id <> NEW.player_id;
  IF counted + 1 > owner_cap THEN
    RAISE EXCEPTION 'owner % is at the cap of % sovereign players', NEW.owner_id, owner_cap
      USING ERRCODE = 'check_violation',
            HINT = 'retire a player or raise the cap with mcp-tokens owner set-cap';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER mcp_players_owner_cap
BEFORE INSERT OR UPDATE OF status, owner_id ON mcp_players
FOR EACH ROW
EXECUTE FUNCTION mcp_enforce_owner_cap();

INSERT INTO schema_migrations (version) VALUES ('0006') ON CONFLICT DO NOTHING;
