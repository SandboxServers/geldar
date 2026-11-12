-- Migration 0022: the consent record written at sign-up (C7-08). One row per new owner: the hash of
-- the identity, the terms version the owner accepted, and the time. No name, no email, no provider
-- subject id. The register service writes it in the same transaction as the owner (pg-store).
-- The register role gets INSERT only: no read, no update, no delete (least privilege, 0056).

CREATE TABLE register_consents (
  identity_hash BYTEA NOT NULL,
  terms_version TEXT NOT NULL CHECK (terms_version ~ '^[a-z0-9][a-z0-9.-]{0,31}$'),
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (identity_hash, terms_version)
);

REVOKE ALL ON register_consents FROM PUBLIC;
GRANT INSERT ON register_consents TO geldar_register;

INSERT INTO schema_migrations (version) VALUES ('0022') ON CONFLICT DO NOTHING;
