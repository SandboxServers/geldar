-- Migration 0052 (decisions 0262 and 0282): erase comments only, no behaviour change.
-- The owner ruled that deleting an owner account erases every life of that owner, alive or dead, including
-- the six life-keyed sheet tables. This supersedes the retention wording in 0051 (which said dead lives stay as
-- world history with no owner link, decision 0171). 0051 is applied and is not edited; these comments replace
-- its texts. sheet_erase_life is unchanged: it deletes by life id and has no alive-only condition.

-- Export and retention map for the six life-keyed tables (texts replace the 0051 comments).
COMMENT ON TABLE character_sheet_adoptions IS 'export: included in the own-rows export of the owner (format to confirm with C7-09); retention: erased by sheet_erase_life for every life of a deleted owner account, alive or dead (decisions 0262 and 0282); the events rows stay';
COMMENT ON TABLE rolls IS 'export: included in the own-rows export of the owner (format to confirm with C7-09); retention: agent-internal audit like thoughts, erased by sheet_erase_life for every life of a deleted owner account, alive or dead (decisions 0262 and 0282); the events rows stay';
COMMENT ON TABLE decisions IS 'export: included in the own-rows export of the owner (format to confirm with C7-09); retention: agent-internal audit like thoughts, erased by sheet_erase_life for every life of a deleted owner account, alive or dead (decisions 0262 and 0282); the events rows stay';
COMMENT ON TABLE xp_evidence IS 'export: included in the own-rows export of the owner (format to confirm with C7-09); retention: erased by sheet_erase_life for every life of a deleted owner account, alive or dead (decisions 0262 and 0282); the events rows stay';
COMMENT ON TABLE proficiency IS 'export: included in the own-rows export of the owner (format to confirm with C7-09); retention: erased by sheet_erase_life for every life of a deleted owner account, alive or dead (decisions 0262 and 0282)';
COMMENT ON TABLE proficiency_outbox IS 'export: none, internal publication queue and not owner data; retention: erased only by sheet_erase_life, for every life of a deleted owner account, alive or dead (decisions 0262 and 0282)';

COMMENT ON FUNCTION sheet_erase_life(TEXT) IS 'Erases the rows of one life from rolls, decisions, xp_evidence, character_sheet_adoptions, proficiency and proficiency_outbox. Called for every life of a deleted owner account, alive or dead (decisions 0262 and 0282); the id must name one life and nothing else is erased. The events rows that match the erased rows stay (0171 open question for events of retired lives). Logs nothing.';

INSERT INTO schema_migrations (version) VALUES ('0052') ON CONFLICT DO NOTHING;
