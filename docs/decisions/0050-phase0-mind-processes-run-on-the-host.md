# 0050. In Phase 0 the Mind, the local Thinker and Adam's Body run as host processes

- Status: Accepted (owner, 2026-11-09, wave 5 planning question Q2); amends the consequence line of decision 0002
- Date: 2026-11-09
- Spec: 5.1, 5.3, 5.6; decisions 0002 (Phase 0 host and models), 0021, 0040; the threat model's loopback rules

## Decision

`lantern-local` (the local Thinker), `animus` (the Mind) and Adam's Body run as Node processes on the desktop, started and stopped by `./geldar.ps1 adam up|down|status|logs`. Every address is loopback: NATS `127.0.0.1:4222`, Postgres `127.0.0.1:5432`, Ollama `127.0.0.1:11434`, the Mind's Thinker socket `127.0.0.1:7410`. Secrets are read from `compose/secrets/*.txt`.

## Why

Ollama listens only on `127.0.0.1` and the threat model forbids changing that, so Docker Desktop containers cannot reach it (decision 0002's note that containers reach it at `host.docker.internal:11434` does not hold). Golem also refuses any NATS address that is not loopback. Host processes keep both rules and the GPU path simple.

## Consequences

- The shard (Paper, Velocity, Postgres, NATS, eventsink) stays in compose; the Mind side is outside it. `docs/threat-model.md` gains rows for the Mind's Thinker socket and the world-text wrapper (P0-33).
- Containerising the Mind (and moving to vLLM) is a Phase 1 change.
