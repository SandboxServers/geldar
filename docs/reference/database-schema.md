---
title: Database schema
type: reference
audience: agents-never
status: draft
last_verified: 2026-11-16 against 1b114276
companions: [README.md, eventsink.md, contract-schemas.md, glossary.md, ../../sql/README.md, ../runbooks/account-deletion.md, ../runbooks/add-a-migration.md, ../security/privacy-and-data-retention.md]
sources: [sql, sql/README.md, sql/test, tools/migrate, .github/workflows/ci.yml, compose/phase0.yml, compose/colo.yml, eventsink/src/writer.ts, animus/src/memory/journal.ts, animus/src/memory/pg-memory-store.ts, threshold/mcp/src/store/pg-journal.ts, threshold/mcp/src/ports.ts, glass/src/kino/audit.ts, tools/mcp-tokens/src/players.ts, ../decisions/0026-one-database-per-shard.md, ../decisions/0085-append-only-audit-tables.md, ../decisions/0133-colo-admin-by-one-shot-container.md, ../decisions/0135-self-registration-with-github-and-discord.md, ../decisions/0171-account-erasure-rule.md, ../decisions/0185-per-turn-record-for-kit-minds.md, ../decisions/0262-account-deletion-erases-dead-lives-too.md, ../decisions/0282-sheet-erasure-covers-dead-lives.md]
---

# Database schema

Every table, column, role, grant, function and trigger the 48 migrations in `sql/` create, what each migration adds, and the retention and erasure rules the migrations and decisions state. Read from the migration files at 1b114276 on 2026-11-16. No database was queried (plan decision D8), so what a node has applied is unverified.

Tables and functions that serve observation (thoughts, journals, the per-turn record, Kino) are marked **agents-never** and described at the level spec Appendix D and the decision titles state, with no visibility rule detail ([documentation style](../agents/documentation-style.md#agents-never-learn-they-are-watched)).

For how to add a migration, see [add-a-migration](../runbooks/add-a-migration.md). For the privacy view, see [privacy-and-data-retention](../security/privacy-and-data-retention.md).

## How migrations apply

| Fact | Evidence |
|---|---|
| One database per shard; Postgres 16 with `pgvector` | spec section 5 ("Storage"); decision 0026 |
| Files are `NNNN_slug.sql`, applied in name order; a merged migration is never edited | `sql/README.md` |
| A fresh volume applies every file through the Postgres image's init directory (`../sql` mounted read-only at `/docker-entrypoint-initdb.d`) | `sql/README.md`; `compose/phase0.yml` line 25; `compose/colo.yml` line 51 |
| A live database is migrated by `tools/migrate` (`--dry-run` lists, a plain run applies each pending file in its own transaction, under an advisory lock) and recorded in `schema_migrations` | `sql/README.md` "Runner" |
| Each migration from 0003 on inserts its own `schema_migrations` row; 0002 inserts `0001` and `0002` | `sql/README.md`; `sql/0002_sovereign_mcp.sql` line 11 |
| `tools/migrate --set-role-password <role> --password-file <file>` sets a role's password and lets it log in; migrations create roles NOLOGIN | `sql/README.md`; 0002, 0005 headers |
| CI applies every `sql/[0-9]*.sql` with `psql -v ON_ERROR_STOP=1`, then runs the 27 files in `sql/test/` | `.github/workflows/ci.yml` (the psql step list) |
| A deviation from spec Appendix D is marked in the file by a comment starting `differs from spec Appendix D` | `sql/README.md` |

Re-derive the migration list and the gaps:

```powershell
git ls-files sql | ForEach-Object { if ($_ -match '^sql/(\d{4})_') { $Matches[1] } }
```

On 2026-11-21 at the mc-sql fix 2 commit this prints 49 numbers from 0001 to 0068. Numbers 0028 to 0030, 0041 to 0049, 0054 to 0059 and 0064 have no file; 0065's header says 0064 is reserved for another branch.

## Migrations

| No. | File | Adds or changes | Decisions and cards |
|---|---|---|---|
| 0001 | `0001_init.sql` | `vector` extension; the Appendix D tables `agents`, `thoughts`, `intents`, `actions`, `receipts`, `suppressed_wakeups`, `memories`, `relationships`, `goals`, `skills`, `skill_runs`, `skill_library`, `books`, `ledger`, `proposals`, `votes`, `laws`, `events`; index `receipts_one_final_per_action`; HNSW index on `memories.embedding`; index on `events (type, world_day)`; schema `archive` | spec Appendix D; 0020 |
| 0002 | `0002_sovereign_mcp.sql` | `schema_migrations`, `mcp_owners`, `mcp_players`, `mcp_tokens`, `mcp_budget`, `mcp_journal`; trigger `mcp_tokens_revoked`; role `geldar_mcp` | 0026 (sovereign MCP); spec 5.15.3, 5.7 |
| 0003 | `0003_mcp_sleep_marks.sql` | `mcp_sleep_marks`; index `mcp_journal_life_id_idx`; trigger `mcp_players_ended`; narrows `geldar_mcp` to six `agents` columns; grants DELETE on `mcp_journal` (revoked again in 0007) | wave M review |
| 0004 | `0004_mcp_sleep_marks_grants.sql` | `geldar_mcp` UPDATE on `mcp_sleep_marks` narrowed to three columns | wave M fix F5 |
| 0005 | `0005_glass_reader.sql` | role `geldar_glass` (read-only) | wave 6 item 11 |
| 0006 | `0006_owner_cap_trigger.sql` | trigger `mcp_players_owner_cap` enforces `mcp_owners.player_cap` | fix packet B item 5 |
| 0007 | `0007_journals_append_only.sql` | append-only triggers on `receipts`, `thoughts`, `suppressed_wakeups`, `mcp_journal`; revokes `geldar_mcp` UPDATE and DELETE on `mcp_journal` | 0085 |
| 0008 | `0008_register_identities.sql` | `mcp_identities`; role `geldar_register` with direct grants (narrowed by 0009 to 0012) | 0135 |
| 0009 | `0009_register_mint_function.sql` | `register_mint_token`; revokes the register's direct token INSERT | 0135, ruling R33 |
| 0010 | `0010_register_definer_functions.sql` | `register_create_player`, `register_retire_player`; replaces `register_mint_token` with `search_path` pinned `pg_temp` last; lifetime cap of 10 player creations per owner; revokes the register's direct writes; `geldar_mcp` reads `mcp_identities (owner_id, banned_at)` | 0135, rulings R34 to R36 |
| 0011 | `0011_register_signup_function.sql` | `register_create_owner`; recreates `register_create_player` without a credits argument (start credits 240 as a constant); pins the owner-cap function's `search_path`; identity row locked in mint and create | 0135, F12 to F17 |
| 0012 | `0012_register_read_functions.sql` | `register_find_owner`, `register_list_players`, `register_count_new_owners`; revokes the register's direct SELECTs | 0135, F19, F22 |
| 0013 | `0013_register_daily_owner_cap.sql` | daily cap of 10 new owners inside `register_create_owner` (removed by 0014) | 0135, F28 |
| 0014 | `0014_kino_access.sql` | provider `microsoft` allowed; `register_create_owner` takes only `microsoft` and drops the daily cap; `kino_admins`; `agents.public_camera`; `register_set_public_camera` | 0135 amendment, rulings R40 to R42 |
| 0015 | `0015_kino_audit.sql` | `kino_audit`; `kino_audit_record`, `kino_audit_purge` | 0075 amendment (K06) |
| 0016 | `0016_thought_visibility.sql` | `agents.thoughts_delayed_public`, `agents.thoughts_flag_changed_at`; `register_set_thoughts_delayed_public`; `glass_owner_agents` | 0138 |
| 0017 | `0017_kino_scope_functions.sql` | `kino_viewer`, `kino_agent_scope` | Kino review fix A |
| 0018 | `0018_kino_agent_list.sql` | `kino_agent_scope` refuses NULL and empty; `kino_agent_list` | Kino fix D1 |
| 0019 | `0019_kino_agent_list_no_owner.sql` | `kino_agent_list` recreated without the owner column | Kino fix E2 |
| 0020 | `0020_glass_journal_thoughts.sql` | `glass_journal_page`, `glass_journal_after` | 0138 |
| 0021 | `0021_register_sessions.sql` | `register_sessions` | C7-01 |
| 0022 | `0022_register_consents.sql` | `register_consents` | C7-08 |
| 0023 | `0023_death_count.sql` | `mcp_life_deaths`, `mcp_death_events` | PX-0b1 |
| 0024 | `0024_mcp_roster.sql` | `mcp_roster` | 0108 (C3-04s) |
| 0025 | `0025_admin_flag_and_register_audit.sql` | `mcp_owners.is_admin`; `register_is_admin`; `register_audit` with its append-only trigger | 0170 (C7-12) |
| 0026 | `0026_owner_api_keys.sql` | `owner_api_keys`; `register_owner_key_resolve`, `register_mint_owner_key`, `register_revoke_owner_key`, `register_list_owner_keys` | 0170 point 2, 0152 (C7-02b) |
| 0027 | `0027_body_ops.sql` | `body_ops`; role `geldar_supervisor`; `supervisor_is_admin` | 0170 (C7-03a) |
| 0031 | `0031_skin_uploads.sql` | `skin_uploads`: owner skin uploads held as `pending` (PNG bytes, sha256, status, reason code); register may INSERT and SELECT, not UPDATE; column `lock_cleared_at` (set by the operator on rejected rows, releases the 3-rejects lock; CHECK: rejected rows only) | C7-13a |
| 0032 | `0032_token_lifecycle.sql` | token life 90 days in `register_mint_token`; `register_renew_token`, `register_revoke_tokens`, `register_token_info` | 0170 point 1 (C7-02a) |
| 0033 | `0033_supervisor_display_name.sql` | `supervisor_player_display_name` | C7-03b3 |
| 0034 | `0034_operator_player_flags.sql` | `operator_set_player_flags`, EXECUTE for the operator role `geldar` | 0138, 0014 (C7-14) |
| 0035 | `0035_owner_keys_by_session.sql` | `register_session_mint_owner_key`, `register_session_list_owner_keys`, `register_session_revoke_owner_key` | 0173 (C7-04b-3) |
| 0036 | `0036_owner_agents_by_owner_id.sql` | `register_owner_list_players`, `register_owner_get_player` | C7-04b-5 |
| 0037 | `0037_events_harness_model.sql` | `events.harness`, `events.model`; `geldar_mcp` reads `agents.declared_model` | GX-01a |
| 0038 | `0038_body_helper_role.sql` | role `geldar_helper` | 0260 (C7-03c1) |
| 0039 | `0039_account_deletion.sql` | `mcp_identities.owner_id` nullable (ban tombstone); `register_account_delete` | 0171 (C7-09a) |
| 0040 | `0040_account_deletion_all_lives.sql` | `register_account_delete` replaced: erases every life of the owner, dead or alive | 0262 (C7-09a2) |
| 0050 | `0050_character_sheet_xp.sql` | `agents.character_sheet`, `sheet_hash`, `sheet_adopted_at` with shape check and immutability trigger; `proficiency`, `xp_evidence`, `proficiency_outbox` | 0186, 0280 (AN-04a) |
| 0051 | `0051_character_audit.sql` | `character_sheet_adoptions`, `rolls`, `decisions`; `sheet_append_only` triggers; `sheet_erase_life`; export and retention comments | 0171, 0186, 0280 (AN-04b) |
| 0052 | `0052_character_erase_comments.sql` | table comments only: sheet tables erased for every life of a deleted owner | 0262, 0282 |
| 0060 | `0060_turn_records.sql` | `turn_records` (**agents-never**); INSERT and SELECT for `geldar` | 0185 (GX-05a) |
| 0061 | `0061_roster_auto.sql` | `register_roster_add` | 0261 item 3a |
| 0062 | `0062_owner_export.sql` | `register_owner_export` | C7-09b |
| 0063 | `0063_body_host_roles.sql` | `mcp_players.host_key`; role `geldar_body_host`; `managed_life_id`, `supervisor_player_life_id`, `player_host_config`; `geldar_mcp` narrowed to six `mcp_players` columns | 0260, 0261 (BH-1) |
| 0065 | `0065_owner_export_budget.sql` | `register_owner_export` replaced with lower byte budget and row caps | C7-09b |
| 0066 | `0066_events_trace_id.sql` | `events.trace_id TEXT` (nullable, no default, no index); hidden from `geldar_glass` and `geldar_mcp` | T-08 |
| 0067 | `0067_skin_upload_rules.sql` | `register_skin_submit` (PNG signature, sha256 and the 32768-byte cap checked; a banned owner is refused; one pending per agent; the lock: 3 rejects of the owner within 30 days (decided_at), held until the operator sets `skin_uploads.lock_cleared_at` (0031 column); 1 hour after a reject per agent; 3 a day per agent; admin exempt from the rate rules and the lock; audit `skin.upload` with the hashed owner id) and `register_skin_status`, both SECURITY DEFINER; `register_account_delete` recreated from 0053 (which also deletes turn_records) with the `skin_uploads` delete added | C7-13a, decision 0172 |
| 0068 | `0068_mc_ownership.sql` | `mcp_identities` gets `owns_java`, `mc_checked_at`, `mc_profile_uuid` (NULL = not checked; the pair CHECK; the profile id is 32 lowercase hex); `register_mc_ownership_record` (SECURITY DEFINER, one-time record of the sign-up Minecraft ownership answer; callable only by `geldar_register`, caller-only: the new-sign-ups-only rule is enforced in the register service layer, decided by the owner; the audit row holds the action `mc.ownership`, outcome `recorded` and an empty detail, never the answer); `register_account_delete` recreated from 0067 (the ban tombstone clears the three columns); `register_owner_export` recreated from 0065 (`identity.mc_ownership`) | mc-sql (owner-approved design) |

## Tables

Columns are as created, then the later migrations in "Changed by". "Grants" lists every non-owner role with a privilege at 1b114276, after all grants and revokes. A table with no grant is reached only by the table owner, a superuser, or the operator role `geldar` where noted.

### Spec Appendix D tables (0001)

| Table | Key | Columns | Changed by | Grants | Writers named in code |
|---|---|---|---|---|---|
| `agents` (one row per life) | `agent_id` | `name`, `life_seq`, `game_account` (unique), `shard`, `mode` (`headless`, `sovereign`), `owner`, `harness`, `declared_model`, `model_config`, `tier`, `personality_seed`, `born_at`, `born_day`, `died_at`, `death_cause`, `parent_a`, `parent_b` (both reference `agents`), `budget_remaining`, `budget_daily`, `last_sleep_day` | 0014 `public_camera`; 0016 `thoughts_delayed_public`, `thoughts_flag_changed_at`; 0050 `character_sheet`, `sheet_hash`, `sheet_adopted_at` | `geldar_mcp`: SELECT `agent_id`, `name`, `game_account`, `personality_seed`, `born_day`, `died_at`, `declared_model`. `geldar_glass`: SELECT `agent_id`, `name`, `life_seq`, `shard`, `mode`, `tier`, `born_day`, `died_at`, `death_cause`, `public_camera`, `thoughts_delayed_public` | Mind (`animus/src/memory/pg-memory-store.ts`); `tools/mcp-tokens/src/players.ts`; register definer functions; event sink (sheet columns) |
| `thoughts` (**agents-never**) | `thought_id` | `life_id`, `at`, `world_day`, `world_tick`, `wake_reason`, `snapshot`, `model_input`, `prompt_template_version`, `schema_version`, `mind_version`, `body_version`, `model_config`, `thinker_id`, `effort`, `tokens_in_estimated`, `tokens_out_estimated`, `provider_usage`, `raw_output`, `parsed`, `latency_ms`, `credits_reserved`, `credits_settled` (spec Appendix D) | 0007 append-only | `geldar_glass`: SELECT | Mind (`animus/src/memory/journal.ts`) |
| `intents` | `intent_id` | `life_id`, `body_generation`, `thought_id`, `goal`, `program`, `arguments`, `preconditions`, `wake_on`, `limits`, `checkpoint`, `state` (`accepted`, `running`, `completed`, `failed`, `cancelled`), `started_tick`, `ended_tick`, `end_reason` | none | `geldar_glass`: SELECT | event sink projection; Mind sets `thought_id` |
| `actions` | `action_id` | `intent_id`, `life_id`, `body_generation`, `sequence`, `source_snapshot_id`, `expires_tick`, `kind`, `args`, `snapshot_revision`, `state` (same five), `result`, `receipt_id` | none | `geldar_glass`: SELECT | event sink projection |
| `receipts` | `receipt_id`; unique `(action_id, phase)`; one final per action | `action_id` (not null), `life_id`, `kind`, `phase` (`prepared`, `committed`, `aborted`), `item`, `count`, `credits`, `at`, `detail` | 0007 append-only | `geldar_glass`: SELECT | event sink projection |
| `suppressed_wakeups` | `id` | `life_id`, `at`, `event_types`, `reason`, `intent_id` | 0007 append-only | none | not checked |
| `memories` | `memory_id` | `agent_id`, `kind` (`episodic`, `semantic`), `provenance` (six values), `subject`, `text`, `embedding vector(768)` (HNSW cosine index), `created_day`, `source_thought`, `source_agent`, `due_tick`, `resolved`, `active` | none | none | Mind (`pg-memory-store.ts`) |
| `relationships` | `(agent_id, other_id)` | `impression`, `trust`, `last_seen_day` | none | none | not checked |
| `goals` | `(agent_id, rank)` | `goal`, `why` | none | none | not checked |
| `skills` | `(skill_id, edition)` | `name`, `description`, `program`, `content_hash`, `language`, `author`, `manifest`, `depends_on`, `tests`, `test_results`, `created_day`, `size_bytes` | none | none | not checked |
| `skill_runs` | `id` | `skill_id`, `edition`, `life_id`, `intent_id`, `outcome`, `cpu_ms`, `world_ticks`, `model_calls_during` | none | none | not checked |
| `skill_library` | `(agent_id, skill_id, edition)`; FK `(skill_id, edition)` to `skills` | `learned_day`, `learned_from_book` | none | none | not checked |
| `books` | `book_id`; FK `(skill_id, edition)` to `skills` | `title`, `skill_id`, `edition`, `text`, `author`, `written_day`, `destroyed_day`, `destroyed_how` | none | none | not checked |
| `ledger` (shrine offerings) | `id` | `agent_id`, `item`, `count`, `thoughts_credited`, `world_day`, `shrine_pos` | none | none | not checked |
| `proposals` | `proposal_id` | `proposer`, `rule`, `value`, `reason`, `opened_day`, `closes_day`, `status`, `yes`, `no` | none | none | not checked |
| `votes` | `(proposal_id, agent_id)` | `vote`, `world_day` | none | none | not checked |
| `laws` | `law_id` | `proposal_id`, `rule`, `value`, `kind`, `enacted_day`, `repealed_day` | none | none | not checked |
| `events` | `event_id`; unique `source_event_id` | `at`, `world_day`, `world_tick`, `type`, `agent_id`, `thinker_id`, `payload` | 0037 `harness`, `model` | `geldar_glass`: SELECT `type`, `agent_id`, `world_day`, `world_tick`, `at`, `source_event_id` | event sink ([eventsink](eventsink.md)) |

Schema `archive` exists for copies of dead agents' tables; 0001 creates it and grants nothing.

### Sovereign MCP tables

| Table | Created | Key | Columns | Changed by | Grants |
|---|---|---|---|---|---|
| `schema_migrations` | 0002 | `version` | `applied_at` | none | none |
| `mcp_owners` | 0002 | `owner_id` | `display`, `player_cap` (default 3, 0 to 50) | 0025 `is_admin` | `geldar_mcp`: SELECT |
| `mcp_players` | 0002 | `player_id` (`^ag-[a-z0-9]+(-[a-z0-9]+)*$`) | `owner_id`, `life_id` (unique, references `agents`), `display_name`, `harness`, `status` (`active`, `paused`, `retired`) | 0063 `host_key` (UUID, server-generated) | `geldar_mcp`: SELECT `player_id`, `owner_id`, `life_id`, `display_name`, `harness`, `status` |
| `mcp_tokens` | 0002 | `token_id`; unique `token_hash` (32 bytes, HMAC-SHA256 under a pepper; the token is never stored) | `player_id`, `label`, `created_at`, `expires_at`, `revoked_at`, `last_used_at` | none | `geldar_mcp`: SELECT, UPDATE `last_used_at` |
| `mcp_budget` | 0002 | `life_id` | `credits` (>= 0), `accrued_at` | none | `geldar_mcp`: SELECT, UPDATE |
| `mcp_journal` (**agents-never**) | 0002 | `id` | `life_id`, `at`, `text` (at most 4000 characters) | 0003 index; 0007 append-only | `geldar_mcp`: SELECT, INSERT, sequence USAGE |
| `mcp_sleep_marks` | 0003 | `life_id` | `last_sleep_day`, `sleep_cursor`, `updated_at` | none | `geldar_mcp`: SELECT, INSERT, UPDATE of the three columns |
| `mcp_life_deaths` | 0023 | `life_id` | `death_count`, `last_death_day`, `last_death_at` | none | `geldar_mcp`: SELECT, INSERT, UPDATE |
| `mcp_death_events` | 0023 | `event_id` | `life_id`, `recorded_at` | none | `geldar_mcp`: SELECT, INSERT |
| `mcp_roster` | 0024 | `player_name` (lower case) | `owner_id`, `max_agents` (1 to 4, default 1), `created_at` | none | `geldar_supervisor`: SELECT |

### Registration and owner tables

| Table | Created | Key | Columns | Changed by | Grants |
|---|---|---|---|---|---|
| `mcp_identities` | 0008 | `identity_hash` (32 bytes, HMAC-SHA256 of provider and provider id; no email or raw id column) | `provider` (`github`, `discord`; 0014 adds `microsoft`), `owner_id` (unique), `created_at`, `banned_at`, `owns_java`, `mc_checked_at`, `mc_profile_uuid` (0068; NULL = not checked: every existing owner, and an identity before its one-time sign-up check) | 0014 provider check; 0039 `owner_id` nullable; 0068 CHECK: `owns_java` and `mc_checked_at` are NULL together, `mc_profile_uuid` is NULL or 32 lowercase hex; the three are NULL on the ban tombstone | `geldar_mcp`: SELECT `owner_id`, `banned_at` |
| `register_sessions` | 0021 | `session_hash` (SHA-256 of the cookie id) | `owner_id`, `identity_hash`, `signed_in_ms`, `last_seen_ms`, `expires_ms` | none | `geldar_register`: SELECT, INSERT, UPDATE, DELETE |
| `register_consents` | 0022 | `(identity_hash, terms_version)` | `accepted_at` | none | `geldar_register`: INSERT |
| `register_audit` | 0025 | `id` | `at`, `actor` (1 to 64), `action` (1 to 64), `target` (1 to 128), `outcome` (1 to 32), `admin`, `detail` (at most 256) | none | `geldar_register`: SELECT, INSERT, sequence; `geldar_supervisor`: INSERT, sequence |
| `skin_uploads` | 0031, 0067 | `id` | `owner_id`, `player_id`, `png` (1 to 32768 bytes), `sha256` (32 bytes), `status` (pending, approved, rejected, applied), `reason_code`, `created_at`, `decided_at`, `decided_by`, `lock_cleared_at` (set by the operator on rejected rows only) | none; erased with the owner by `register_account_delete` (0067) | `geldar_register`: SELECT, INSERT (no UPDATE); the table owner `geldar` sets `lock_cleared_at` and decides rows |
| `owner_api_keys` | 0026 | `key_id` (`^gok-[0-9a-f]{16}$`); unique `key_hash` (32 bytes) | `owner_id`, `scopes` (subset of `read`, `body`, `manage`), `created_at`, `expires_at`, `revoked_at`, `last_used_at` | none | none (definer functions only) |
| `body_ops` | 0027 | `id` | `at`, `owner_id`, `player_name`, `op` (`start`, `restart`) | none | `geldar_supervisor`: SELECT, INSERT, sequence |

### Kino tables (**agents-never**)

| Table | Created | Purpose | Grants |
|---|---|---|---|
| `kino_admins` | 0014 | identities allowed Kino admin access; written by `tools/mcp-tokens` | `geldar_glass`: SELECT |
| `kino_audit` | 0015 | the pane audit trail (hash of the login id, agent, pane, mode, time; no token or name) | none; written and purged only through definer functions |

Design: decisions 0075 and 0100; the [Glass and Kino reference](glass-and-kino.md) (`agents-never`).

### Character sheet tables

| Table | Created | Key | Columns | Grants |
|---|---|---|---|---|
| `proficiency` | 0050 | `(life_id, domain)` | `domain` (`combat`, `farming`, `mining`, `building`, `crafting`, `exploring`, `social`), `xp` (>= 0), `level` (0 to 3), `updated_tick` | none |
| `xp_evidence` | 0050 | `(life_id, domain, evidence_key)` | `evidence_key` (1 to 200), `source_event_id`, `world_tick`, `awarded_at` | none |
| `proficiency_outbox` | 0050 | `outbox_id`; unique `(life_id, domain, level)` | `domain`, `level` (1 to 3), `xp`, `version`, `created_at`, `published_at` | none |
| `character_sheet_adoptions` | 0051 | `adoption_id`; unique `source_event_id` (references `events`) | `life_id`, `sheet_hash` (64 hex), `sheet`, `source` (`config`, `roster`, `birth`), `result` (`adopted`, `same`, `conflict`), `recorded_at` | none |
| `rolls` | 0051 | `source_event_id` (references `events`); unique `(life_id, decision_id, draw_index)` | `world_tick`, `decision_id`, `draw_index`, `engine_version`, `producer` (`body`, `kit`), `fx`, `score` (1 to 5), `proficiency` (0 to 3), `dc`, `mode` (`dis`, `flat`, `adv`), `dice` (1 or 2), `kept`, `bonus`, `total`, `success`, `inputs` | none |
| `decisions` | 0051 | `source_event_id` (references `events`); unique `(life_id, decision_id)` | `world_tick`, `decision_id`, `engine_version`, `producer`, `fx`, `kind` (`d20`, `uniform`, `deterministic`, `audit_gap`), `policy`, `inputs`, `result`, `roll_event_ids`, `thought_id`, `action_id`, `intent_id`, `dropped`, `since_tick` | none |

Sheet data is operator-readable only: nothing is granted to PUBLIC, `geldar_mcp`, `geldar_glass`, `geldar_register` or `geldar_supervisor` (0050 and 0051 headers). The event sink writes these tables ([eventsink](eventsink.md#tables-written)).

### Per-turn record (**agents-never**)

| Table | Created | Purpose | Grants |
|---|---|---|---|
| `turn_records` | 0060 | one row per model call of a kit Mind; operator-only; no owner link; meant to be erased by `life_id`, account deletion erases it by `life_id` (0053; kept by 0067; see [data retention and erasure](#data-retention-and-erasure)). Nothing writes it at 1b114276 (the writer GX-05b stays off unless `GELDAR_TURN_RECORD=1`) | `geldar`: INSERT, SELECT (granted only when the role exists) |

Decision 0185.

## Roles

| Role | Created | Logs in | Purpose | Evidence |
|---|---|---|---|---|
| `geldar_mcp` | 0002 | NOLOGIN as created; `tools/migrate --set-role-password` sets the password and login | the MCP server | 0002 header |
| `geldar_glass` | 0005 | NOLOGIN as created; same step | Glass and the report generator, read-only | 0005 header |
| `geldar_register` | 0008 | NOLOGIN as created | the register service; from 0012 on it writes and reads only through definer functions, plus `register_sessions`, `register_consents`, `register_audit` | 0008 to 0012 headers |
| `geldar_supervisor` | 0027 | NOLOGIN as created | the body supervisor | 0027 |
| `geldar_helper` | 0038 | NOLOGIN as created; C7-03c2 sets its password | the body helper host process; no table privilege | 0038 header |
| `geldar_body_host` | 0063 | NOLOGIN as created | a managed Body reading its host config; no table privilege | 0063 header |
| `geldar` | not created by a migration: the Postgres image creates it from `POSTGRES_USER` | yes | the bootstrap superuser ("Postgres roles are still the superuser `geldar` for admin work", decision 0133); the role `tools/mcp-tokens` and `tools/admin` connect as (0034 calls it the operator role); the event sink's default `POSTGRES_USER` (0060) | `compose/phase0.yml` line 19; `compose/colo.yml` line 45; decision 0133; 0034 and 0060 headers |

How a node sets each role's password is outside this page (D8; see [secrets-by-role](../security/secrets-by-role.md)).

0001 mentions `mind_role`, `mcp_role` and `historian_role` in a comment only; no migration creates them.

### Function grants by role

| Role | EXECUTE on |
|---|---|
| `geldar_register` | `register_mint_token`, `register_renew_token`, `register_revoke_tokens`, `register_token_info`, `register_create_owner`, `register_create_player`, `register_retire_player`, `register_find_owner`, `register_list_players`, `register_count_new_owners`, `register_set_public_camera`, `register_set_thoughts_delayed_public`, `register_is_admin`, `register_owner_key_resolve`, `register_mint_owner_key`, `register_revoke_owner_key`, `register_list_owner_keys`, `register_session_mint_owner_key`, `register_session_list_owner_keys`, `register_session_revoke_owner_key`, `register_owner_list_players`, `register_owner_get_player`, `register_account_delete`, `sheet_erase_life`, `register_roster_add`, `register_owner_export`, `register_skin_submit`, `register_skin_status`, `register_mc_ownership_record` |
| `geldar_glass` | `glass_owner_agents`, `glass_journal_page`, `glass_journal_after`, `kino_viewer`, `kino_agent_scope`, `kino_agent_list`, `kino_audit_record`, `kino_audit_purge` |
| `geldar_supervisor` | `supervisor_is_admin`, `supervisor_player_display_name` |
| `geldar_helper` | `supervisor_player_display_name`, `supervisor_player_life_id` |
| `geldar_body_host` | `player_host_config` |
| `geldar` | `operator_set_player_flags` |

Every listed function has `REVOKE ALL ... FROM PUBLIC` before its grant. Re-derive:

```powershell
git grep -nE '^GRANT EXECUTE|^\s+GRANT EXECUTE' -- 'sql/*.sql'
```

## Functions

45 lines in the migrations declare `SECURITY DEFINER` on 2026-11-16, counting every version of a replaced function (`(git grep -nE '^\s*SECURITY DEFINER' -- 'sql/0*.sql').Count`). Definer functions from 0010 on pin `search_path` with `pg_temp` last and schema-qualify tables (0010 header, F1). The last migration to define a function wins; earlier bodies are history.

| Function | Defined in | Purpose |
|---|---|---|
| `mcp_notify_token_revoked()` | 0002 | trigger: `pg_notify('mcp_token_revoked', {token_id, player_id})` when a token is revoked |
| `mcp_notify_player_ended()` | 0003 | trigger: the same notify for each token of a player that leaves `active` |
| `mcp_enforce_owner_cap()` | 0006, 0011 | trigger: refuses a counted player over `mcp_owners.player_cap`; locks the owner row first |
| `journal_append_only()` | 0007 | trigger: refuses UPDATE and DELETE |
| `register_mint_token(BYTEA, TEXT, TEXT, BYTEA)` | 0009, 0010, 0011, 0032 | mints a token for a player of the caller's owner; revokes older live tokens; 90-day life (0032) |
| `register_create_player(...)` | 0010, 0011, 0012 | creates a player, its life and budget; lifetime cap 10 per owner; start credits 240 |
| `register_retire_player(BYTEA, TEXT)` | 0010 | retires a player of the caller's owner |
| `register_create_owner(...)` | 0011, 0012, 0013, 0014 | sign-up: one owner and one identity; `microsoft` only from 0014 |
| `register_find_owner(BYTEA)`, `register_list_players(BYTEA)`, `register_count_new_owners(TIMESTAMPTZ)` | 0012 | reads for the named identity; a count for the churn cap (unused by the service from 0014) |
| `register_set_public_camera(BYTEA, TEXT, BOOLEAN)` | 0014 | the owner sets a player's public camera flag |
| `kino_audit_record(...)`, `kino_audit_purge(TIMESTAMPTZ)` | 0015 | **agents-never**: append a pane audit row; purge rows older than a cutoff |
| `register_set_thoughts_delayed_public(BYTEA, TEXT, BOOLEAN)` | 0016 | **agents-never**: the owner's opt-in flag for a player's thoughts (decision 0138) |
| `glass_owner_agents(BYTEA)` | 0016 | **agents-never**: which agents a signed-in identity owns, for Glass |
| `kino_viewer(BYTEA)`, `kino_agent_scope(TEXT)` | 0017, 0018 | **agents-never**: who may watch whom, for Kino |
| `kino_agent_list()` | 0018, 0019 | **agents-never**: the Kino picker list |
| `glass_journal_page(...)`, `glass_journal_after(...)` | 0020 | **agents-never**: Glass reads a sovereign player's journal (decision 0138) |
| `register_is_admin(TEXT)` | 0025 | reads the admin flag |
| `register_audit_append_only()` | 0025 | trigger: refuses UPDATE and DELETE on `register_audit` |
| `register_owner_key_resolve(BYTEA)`, `register_mint_owner_key(BYTEA, TEXT, BYTEA, TEXT[])`, `register_revoke_owner_key(BYTEA, TEXT)`, `register_list_owner_keys(BYTEA)` | 0026 | owner API keys by presented key hash; 90-day life; at most 10 live keys |
| `supervisor_is_admin(TEXT)` | 0027 | reads the admin flag for the supervisor |
| `register_renew_token(BYTEA, TEXT, TEXT, BYTEA, TIMESTAMPTZ)`, `register_revoke_tokens(BYTEA, TEXT)`, `register_token_info(BYTEA, TEXT)` | 0032 | rotate with a 10-minute grace for older tokens; end every live token of a player; read token state |
| `supervisor_player_display_name(TEXT, TEXT)` | 0033 | exact-case login name of a roster player, or NULL |
| `operator_set_player_flags(TEXT, BOOLEAN, BOOLEAN)` | 0034 | operator sets a player's two flags; returns `ok`, `unknown-player`, `retired-player`, `no-flags` or `too-soon`; one audit row per call |
| `register_session_mint_owner_key(...)`, `register_session_list_owner_keys(BYTEA)`, `register_session_revoke_owner_key(BYTEA, TEXT)` | 0035 | owner API keys by cookie session |
| `register_owner_list_players(TEXT)`, `register_owner_get_player(TEXT, TEXT)` | 0036 | owner's players by owner id |
| `register_account_delete(BYTEA)` | 0039, 0040, 0053, 0067 | account deletion ([below](#data-retention-and-erasure)) |
| `register_skin_submit(BYTEA, TEXT, BYTEA, BYTEA)` | 0067 | owner skin upload, held as `pending` (decision 0172); refused for a banned owner, a foreign agent, a bad PNG or sha256, and by the pending, lock, wait and daily rules |
| `register_skin_status(BYTEA, TEXT)` | 0067 | the newest skin upload of the owner's agent: status and reason code only, no bytes |
| `register_mc_ownership_record(BYTEA, BOOLEAN, TEXT)` | 0068 | records the one-time sign-up Minecraft ownership answer on the identity; returns false and writes nothing for a NULL answer, a malformed profile id, an unknown or tombstoned identity, or an identity already checked; one `mc.ownership` audit row per recorded answer (`owns-java` or `no-java`, actor the hashed owner id). Callable by `geldar_register` only. No SQL gate on the age of the identity: the sign-up path is the only gate (owner decision pending; a caller bug can stamp a legacy owner) |
| `character_sheet_group_valid(JSONB, TEXT[])`, `character_sheet_valid(JSONB)` | 0050 | shape check of `agents.character_sheet` |
| `agents_sheet_immutable()` | 0050 | trigger: the first non-NULL sheet is the baseline; a change raises |
| `proficiency_monotonic()` | 0050 | trigger: `xp` and `level` never decrease |
| `sheet_append_only()` | 0051 | trigger: refuses UPDATE and TRUNCATE, and DELETE unless the transaction names the row's life in `geldar.erase_life` |
| `sheet_erase_life(TEXT)` | 0051 | erases one life's rows from `rolls`, `decisions`, `xp_evidence`, `character_sheet_adoptions`, `proficiency`, `proficiency_outbox` |
| `register_roster_add(BYTEA, TEXT)` | 0061 | writes the roster row for a new agent; one audit row per success |
| `register_owner_export(BYTEA)` | 0062, 0065 | the owner's own rows as one JSON document (`geldar-owner-export/1`) |
| `managed_life_id(TEXT)` | 0063 | `ag_` plus the first 12 hex digits of SHA-256 of a host key; granted to no one |
| `supervisor_player_life_id(TEXT, TEXT)` | 0063 | the life id of a live roster player, or NULL |
| `player_host_config(TEXT)` | 0063 | a managed Body's `display_name`, `harness`, `model`, `character_sheet`, or NULL |

## Triggers

| Trigger | Table | Fires | Function | Created |
|---|---|---|---|---|
| `mcp_tokens_revoked` | `mcp_tokens` | AFTER UPDATE OF `revoked_at`, when it goes from NULL to set | `mcp_notify_token_revoked` | 0002 |
| `mcp_players_ended` | `mcp_players` | AFTER UPDATE OF `status`, when it leaves `active` | `mcp_notify_player_ended` | 0003 |
| `mcp_players_owner_cap` | `mcp_players` | BEFORE INSERT OR UPDATE OF `status`, `owner_id` | `mcp_enforce_owner_cap` | 0006 |
| `receipts_append_only`, `thoughts_append_only`, `suppressed_wakeups_append_only`, `mcp_journal_append_only` | the four tables | BEFORE UPDATE OR DELETE, per row | `journal_append_only` | 0007 |
| `register_audit_append_only` | `register_audit` | BEFORE UPDATE OR DELETE, per row | `register_audit_append_only` | 0025 |
| `agents_sheet_immutable` | `agents` | BEFORE UPDATE OF `character_sheet`, `sheet_hash`, `sheet_adopted_at` | `agents_sheet_immutable` | 0050 |
| `proficiency_monotonic` | `proficiency` | BEFORE UPDATE | `proficiency_monotonic` | 0050 |
| `xp_evidence_append_only` | `xp_evidence` | BEFORE UPDATE OR DELETE | `sheet_append_only` (was `journal_append_only` in 0050) | 0050, 0051 |
| `rolls_append_only`, `decisions_append_only` | `rolls`, `decisions` | BEFORE UPDATE OR DELETE | `sheet_append_only` | 0051 |
| `rolls_append_only_truncate`, `decisions_append_only_truncate`, `xp_evidence_append_only_truncate` | the three tables | BEFORE TRUNCATE, per statement | `sheet_append_only` | 0051 |

The 0007 triggers hold against ordinary statements and the service roles. The table owner or a superuser can still TRUNCATE, disable a trigger or change `session_replication_role` (0007 header; decision 0085). `register_account_delete` disables and re-enables the four 0007 triggers inside its own transaction (0039, 0040).

Re-derive: `git grep -nE 'CREATE TRIGGER' -- 'sql/*.sql'`.

## Data retention and erasure

| Data | Rule | Evidence |
|---|---|---|
| `events` | nothing prunes it; choosing a policy is an open follow-up | `eventsink/README.md` |
| `mcp_journal` | kept (append-only since 0007); the MCP reads at most the newest 1000 lines of a life | `threshold/mcp/src/store/pg-journal.ts`; `JOURNAL_KEEP` in `threshold/mcp/src/ports.ts` |
| `mcp_tokens` | 90 days from issue; a renewal gives older live tokens a 10-minute grace | 0032 header |
| `owner_api_keys` | 90 days; at most 10 live keys per owner | 0026, 0035 headers |
| `register_sessions` | sliding expiry with a 12-hour cap, computed by the register service, not the table | 0021 header |
| `kino_audit` (**agents-never**) | 90 days; see [privacy-and-data-retention](../security/privacy-and-data-retention.md#retention) | 0015; `AUDIT_RETENTION_DAYS = 90` in `glass/src/kino/audit.ts` line 10 (read 2026-11-16) |
| `register_audit` | append-only; no purge in any migration | 0025 |
| Sheet tables | erased by `sheet_erase_life` for every life of a deleted owner account, alive or dead | 0052 comments; decisions 0262, 0282 |
| `turn_records` | not append-only, but erased by account deletion by `life_id` (`register_account_delete`, 0053; kept by 0067). Nothing writes the table yet | 0060 header; 0062 and 0065 (`not_included`: "erasure is deferred to GX-05c"); decision 0185 open questions; [privacy-and-data-retention](../security/privacy-and-data-retention.md#gaps) gap 4 |

### Account deletion (`register_account_delete`, 0040, 0053, 0067, 0068)

The current body (0067: the 0053 body with one statement added, which replaced 0040) runs in one transaction with `lock_timeout` 3 s. For every life of the owner, dead or alive, it calls `sheet_erase_life` and deletes the life's rows from `mcp_sleep_marks`, `mcp_budget`, `mcp_life_deaths`, `mcp_death_events`, `actions`, `intents`, `skill_runs`, `memories`, `goals`, `skill_library`, `relationships` (both sides), `ledger`, `votes`, `events` (by `agent_id` or `thinker_id`), `mcp_journal`, `thoughts`, `receipts`, `suppressed_wakeups` and `turn_records`. For the owner it deletes tokens, `mcp_players`, `owner_api_keys`, `mcp_roster`, `body_ops`, `skin_uploads`, and for the identity `register_sessions`, `register_consents`, `kino_admins` and its `kino_audit` rows; then the identity (or, when banned, keeps it as a tombstone with `owner_id` NULL, and from 0068 with `owns_java`, `mc_checked_at` and `mc_profile_uuid` NULL) and the owner. It keeps the `agents` rows without the owner link, the ban tombstone, the `register_audit` row (random erasure actor) and the shared world objects `skills.author`, `books.author`, `proposals.proposer` and `laws` (0040 header and body, lines 67 to 144). It erases `turn_records` by `life_id` (0053; 0067 keeps that statement) and, for the owner, the `skin_uploads` rows, pending and decided, with their PNG bytes (0067, decision 0172 point 7). The `geldar-skins` KV key is not removed by the function. The procedure for operators is the [account-deletion runbook](../runbooks/account-deletion.md).

0040 depends at call time on `sheet_erase_life` (0051): without 0051 every deletion fails and rolls back (0040 header).

### Owner export (`register_owner_export`, 0065, 0068)

Returns one JSON document (`geldar-owner-export/1`) of the owner's own rows, or NULL. Per-table caps: 20000 rows and 3000000 bytes of text for `thoughts` and `mcp_journal`; list caps players 150, tokens 150, roster 100, `body_ops` 500, consents 100, lives 50. It leaves out token hashes, the owner id, identity hashes, and the `thoughts` columns `model_input`, `snapshot`, `raw_output` and `provider_usage`; `turn_records` is named under `not_included`. One `register_audit` row per successful call (0065 header). From 0068 the identity object lists `mc_ownership`: `owns_java`, `checked_at` and `mc_profile_uuid`, each JSON null when the identity was not checked.

## Conflicts and open points

1. **Events after account deletion.** The 0052 comments on `character_sheet_adoptions`, `rolls`, `decisions` and `xp_evidence` end "the events rows stay". `register_account_delete` in 0040 deletes `events` rows by `agent_id` or `thinker_id` for every life of the owner (0040 line 83). Decision 0262 says 0040 supersedes 0171 point 2. The comments and the function disagree; recorded, not resolved.
2. **0051 erase contract.** The 0051 header says `sheet_erase_life` is called only for a life alive at deletion and dead lives stay as world history (decision 0171). 0052 and 0040 replace that with every life (decisions 0262, 0282). 0051 is not edited by rule; its header is history.
3. **Journal trim.** The 0003 and 0004 headers say the MCP journal store deletes rows past the newest 1000 per life and grant DELETE for it. 0007 revokes DELETE and makes `mcp_journal` append-only; `pg-journal.ts` now only windows reads. The older headers are history.
4. **Supervisor admin read.** The 0027 header says the supervisor reads the admin flag through `register_is_admin` (0025); the migration grants it `supervisor_is_admin` instead, and 0033 refers to `supervisor_is_admin`. Header and code disagree; the code is what runs.
5. **Service roles.** The 0007 header says every service connects as the superuser, and decision 0133 says admin work still uses the superuser `geldar`. Later migrations add per-service roles (0008, 0027, 0038, 0063), and 0060 grants `turn_records` to `geldar` as if it were a separate operator role; a superuser needs no grant. Which role each service uses on a node is unverified (D8).
6. **`archive` schema.** 0001 creates it and leaves its grants as a comment that names roles no migration creates. Nothing copies into it at 1b114276 (`git grep -nE 'archive\.[a-z_]' -- '*.ts' 'sql/*.sql'` finds nothing).
7. **Applied state.** Whether every migration through 0065 is applied on any node is unverified (D8); the plan's finding F-2 records the same for 0006.
