# 0040. The bot-ingress gate reads a NATS KV registry, fails closed, and Golem registers before it connects

- Status: Accepted (made by the orchestrator in wave 3; see `docs/analysis/phase0/overnight-decisions.md` rows 22 to 24)
- Date: 2026-11-09
- Spec: Appendix F (bot ingress identity), section 8.4, 5.1; decision 0021 (Velocity from Phase 0)

## Decision

1. The Velocity plugin `velocity-identity` admits a login only when the lowercase username is a key in the JetStream KV bucket `geldar-life-registry` (value `{life_id, registered_at}`) and matches `[A-Za-z0-9_]{1,16}`. It keeps a local cache, never waits on NATS in the login path, and **fails closed** until the first full sync and whenever the connection drops or the bucket is deleted or recreated (a probe runs every 30 s). Every denial gets one fixed message. Messages on `geldar:cmd` from connections the gate did not admit are dropped.
2. Golem is the creator and writer of the bucket in Phase 0 (it stands in for the production supervisor): it registers its bot username before the first connect and before every reconnect, and deletes the key on stop. The registry is on whenever `GELDAR_NATS_URL` is set; the bench CLI and the live fixture default it to the loopback NATS.
3. A kick with reason "This connection is not admitted." is fatal at once when the registry is off, and after 5 consecutive kicks when it is on (the gate can be closed for seconds after a NATS blip).
4. Golem's life id is the username when it already is a life id, else `ag_<8 characters of the name><8 hex of the SHA-256 of the exact name>_01`, so distinct names never share an id and plugin `agent_id` matches the registry.
5. The Paper whitelist stays on (second layer); Golem still whitelists its bots over RCON.

## Why

Two independent enforcement points (spec 8.4). A gate that fails open when its data source is unreachable is no gate. The registry is a Phase 0 stand-in: production's supervisor writes it.

## Consequences

- Phase 0 NATS is open on the compose network and host loopback, so anything there can write the registry. Per-service NATS accounts (spec 6.5) close this later; the threat model says so.
- A consumer deleted alone on a live bucket is not detected (jnats 2.26.4 exposes no consumer info). A case-differing duplicate login is an unverified edge. Both are recorded in `plugin/README.md` and the threat model.
