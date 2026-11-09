-- Phase 0 schema. Source: spec Appendix D (abridged), with the changes below
-- that match decision 0020 and the action record in the contract (P0-03).
-- Each change is marked "differs from spec Appendix D".

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE agents (                 -- one row per LIFE
  agent_id TEXT PRIMARY KEY,            -- the life ID
  name TEXT NOT NULL, life_seq INT NOT NULL, game_account TEXT UNIQUE NOT NULL,  -- e.g. kestrel_02
  shard TEXT NOT NULL,
  mode TEXT CHECK (mode IN ('headless','sovereign')), owner TEXT, harness TEXT, declared_model TEXT,
  model_config TEXT NOT NULL,           -- pinned weights@quant@sampling@runtime (headless); declared only (sovereign)
  tier TEXT NOT NULL, personality_seed TEXT,
  born_at TIMESTAMPTZ, born_day INT, died_at TIMESTAMPTZ, death_cause TEXT,
  parent_a TEXT REFERENCES agents, parent_b TEXT REFERENCES agents,
  budget_remaining INT, budget_daily INT, last_sleep_day INT
);

CREATE TABLE thoughts (
  thought_id TEXT PRIMARY KEY, life_id TEXT REFERENCES agents, at TIMESTAMPTZ, world_day INT, world_tick BIGINT,
  wake_reason TEXT, snapshot JSONB,
  model_input JSONB,            -- the complete messages array sent, not a hash
  prompt_template_version TEXT, schema_version TEXT, mind_version TEXT, body_version TEXT,
  model_config TEXT, thinker_id TEXT, effort TEXT, tokens_in_estimated INT, tokens_out_estimated INT,
  provider_usage JSONB,         -- provider-reported usage with provenance, when available
  raw_output TEXT, parsed JSONB, latency_ms INT,
  credits_reserved INT, credits_settled INT
);

CREATE TABLE intents (
  intent_id TEXT PRIMARY KEY, life_id TEXT, body_generation INT, thought_id TEXT, goal TEXT, program TEXT,
  arguments JSONB, preconditions JSONB, wake_on JSONB, limits JSONB, checkpoint JSONB,
  state TEXT CHECK (state IN ('accepted','running','completed','failed','cancelled')), started_tick BIGINT, ended_tick BIGINT, end_reason TEXT
);
CREATE TABLE actions (
  action_id TEXT PRIMARY KEY, intent_id TEXT, life_id TEXT, body_generation INT, sequence INT,
  source_snapshot_id TEXT, expires_tick BIGINT, kind TEXT, args JSONB,
  snapshot_revision BIGINT,     -- differs from spec Appendix D: the Body rejects a plan made from an older snapshot revision (spec 5.3.2, section 7)
  state TEXT CHECK (state IN ('accepted','running','completed','failed','cancelled')),  -- differs from spec Appendix D: state is limited to the contract's action states
  result JSONB, receipt_id TEXT
);
CREATE TABLE receipts (                -- two-phase records for economic operations
  receipt_id TEXT PRIMARY KEY, action_id TEXT, life_id TEXT, kind TEXT,
  phase TEXT CHECK (phase IN ('prepared','committed','aborted')), item TEXT, count INT, credits INT, at TIMESTAMPTZ,  -- differs from spec Appendix D: phase is limited to the contract's three receipt phases
  detail TEXT,                         -- differs from spec Appendix D: why an action aborted or what happened (at most 256 characters, decision 0020)
  UNIQUE (action_id, phase)            -- differs from spec Appendix D: one row per phase, so prepared and committed can both exist (decision 0020)
);
CREATE UNIQUE INDEX receipts_one_final_per_action ON receipts (action_id) WHERE phase IN ('committed','aborted');  -- differs from spec Appendix D: exactly one final receipt per action (decision 0020); a prepared row may precede it
CREATE TABLE suppressed_wakeups (     -- the attention controller's record of what it chose not to escalate
  id BIGSERIAL PRIMARY KEY, life_id TEXT, at TIMESTAMPTZ, event_types TEXT[], reason TEXT, intent_id TEXT
);

CREATE TABLE memories (
  memory_id BIGSERIAL PRIMARY KEY, agent_id TEXT REFERENCES agents,
  kind TEXT CHECK (kind IN ('episodic','semantic')),
  provenance TEXT CHECK (provenance IN ('observation','report','interpretation','prediction','commitment','preference')),
  subject TEXT, text TEXT, embedding vector(768),
  created_day INT, source_thought TEXT, source_agent TEXT, due_tick BIGINT, resolved BOOLEAN, active BOOLEAN DEFAULT TRUE
);
CREATE INDEX ON memories USING hnsw (embedding vector_cosine_ops);

CREATE TABLE relationships (
  agent_id TEXT REFERENCES agents, other_id TEXT REFERENCES agents,
  impression TEXT, trust INT, last_seen_day INT, PRIMARY KEY (agent_id, other_id)
);

CREATE TABLE goals (
  agent_id TEXT REFERENCES agents, rank INT, goal TEXT, why TEXT, PRIMARY KEY (agent_id, rank)
);

CREATE TABLE skills (
  skill_id TEXT, edition INT, PRIMARY KEY (skill_id, edition),
  name TEXT, description TEXT, program TEXT, content_hash TEXT, language TEXT,
  author TEXT REFERENCES agents, manifest JSONB, depends_on JSONB, tests JSONB, test_results JSONB,
  created_day INT, size_bytes INT
);
CREATE TABLE skill_runs (              -- observed behavior, separate from the author's description
  id BIGSERIAL PRIMARY KEY, skill_id TEXT, edition INT, life_id TEXT, intent_id TEXT, outcome TEXT, cpu_ms INT, world_ticks BIGINT, model_calls_during INT
);
CREATE TABLE skill_library (          -- who knows what
  agent_id TEXT REFERENCES agents, skill_id TEXT,
  edition INT,                       -- differs from spec Appendix D: a library entry names one edition of a skill, so the key below can point at skills (skill_id, edition)
  learned_day INT, learned_from_book TEXT,
  PRIMARY KEY (agent_id, skill_id, edition),  -- differs from spec Appendix D: edition joins the key (was (agent_id, skill_id))
  FOREIGN KEY (skill_id, edition) REFERENCES skills (skill_id, edition)  -- differs from spec Appendix D: composite foreign key replaces the single-column reference, which skills cannot satisfy (its key is (skill_id, edition))
);
CREATE TABLE books (
  book_id TEXT PRIMARY KEY, title TEXT, skill_id TEXT,
  edition INT,                         -- differs from spec Appendix D: the edition of the skill the book teaches, null only when skill_id is null
  CHECK ((skill_id IS NULL) = (edition IS NULL)),  -- differs from spec Appendix D: a book cannot name a skill without an edition, which would skip the foreign key below
  FOREIGN KEY (skill_id, edition) REFERENCES skills (skill_id, edition),  -- differs from spec Appendix D: composite foreign key replaces the single-column reference, which skills cannot satisfy (its key is (skill_id, edition))
  text TEXT,
  author TEXT REFERENCES agents, written_day INT, destroyed_day INT, destroyed_how TEXT
);

CREATE TABLE ledger (                 -- shrine offerings
  id BIGSERIAL PRIMARY KEY, agent_id TEXT, item TEXT, count INT, thoughts_credited INT, world_day INT, shrine_pos TEXT
);

CREATE TABLE proposals (
  proposal_id TEXT PRIMARY KEY, proposer TEXT REFERENCES agents, rule TEXT, value JSONB, reason TEXT,
  opened_day INT, closes_day INT, status TEXT, yes INT DEFAULT 0, no INT DEFAULT 0
);
CREATE TABLE votes (proposal_id TEXT, agent_id TEXT, vote TEXT, world_day INT, PRIMARY KEY (proposal_id, agent_id));
CREATE TABLE laws (law_id TEXT PRIMARY KEY, proposal_id TEXT, rule TEXT, value JSONB, kind TEXT, enacted_day INT, repealed_day INT);

CREATE TABLE events (                 -- everything, from NATS
  event_id BIGSERIAL PRIMARY KEY,
  source_event_id TEXT UNIQUE NOT NULL, -- assigned at the producer; makes JetStream redelivery idempotent
  at TIMESTAMPTZ, world_day INT, world_tick BIGINT, type TEXT, agent_id TEXT, thinker_id TEXT, payload JSONB
);
CREATE INDEX ON events (type, world_day);

CREATE SCHEMA archive;               -- dead agents' tables are copied here
-- read-only is a matter of grants, not of creating the schema:
-- REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA archive FROM PUBLIC, mind_role, mcp_role, historian_role;
