# 0350: Telemetry scope and full capture

Status: Accepted
Date: 2026-11-15
Spec: section 7 (monitoring: Prometheus and Loki), section 2 (principle 1). Amends 0088 (metrics, traces and logs). Builds on 0130 (SigNoz on the node). Does not edit `docs/spec.md` (0073).

## Context

Phase 1 has no traces and no working metrics. A survey of the Colo on 2026-11-15 (read-only) found:

- No Geldar series exist in SigNoz because nothing is switched on. Four hand-written OTLP/HTTP JSON pushers (golem, the MCP, eventsink, Glass/Kino) exist but are off. The 19 player Bodies never start telemetry.
- No service carries W3C trace context. NATS headers carry only the message id. NATS disconnects are invisible.
- Container logs are json-file and are lost when a container is recreated. Formats mix JSON lines and plain text.
- The Mind's full transcript (`session-<n>.jsonl`) is written on the Mind host and goes nowhere.
- The correlation ids already exist (`life_id`, `body_generation`, `thought_id`, `intent_id`, `action_id`, `turn_id`, the supervisor run number), so traces can use them.

Decision 0130 put telemetry on the node's SigNoz. Decision 0088 allows counters, gauges and histograms only, refuses any label that names a player, a life or a token, and says thought text, persona text, prompts and tokens are never recorded. Decision 0185 keeps prompts and reasoning operator-only and gates them on the open GX-05 ruling. Spec 7 names Prometheus and Loki.

The owner ruled on 2026-11-15: during development all content is captured into SigNoz for diagnosis, with no opt-out; outside players are captured too and their data is erased on request; retention is one year. Claude needs to be able to diagnose the shard from SigNoz, so a trace must reach the thought, the act and the outcome it caused.

## Decision

1. **Amends 0088.** Metrics keep the no-life-label rule and the registry refusal: no metric label names a player, a life, a token or an owner. Traces and logs MAY carry these attributes: `life_id`, `player_id`, `thought_id`, `intent_id`, `action_id`, `run_id`, `turn_id`, and agent names. Owner identities, emails, tokens, cookies, provider subjects and account ids are never attributes, in any signal.

2. **Content policy (owner ruling, 2026-11-15).** During development ALL content is captured into SigNoz with no opt-out: prompts, raw model output, reasoning, thoughts, journals, speech, tool results, action arguments and outcomes, errors, and anything unexpected. This supersedes, for telemetry only, the "never recorded" wording of 0088 and the open GX-05 defaults. It does not settle GX-05 for Postgres. Postgres remains the system of record for content; SigNoz holds a copy for diagnosis.

3. **Outside players.** Their content is captured too, and it is erased on request. SigNoz is a shared instance, and the Geldar database holds only Geldar's data, so erasure is by TTL expiry or by a ClickHouse mutation run by an operator. **This is a KNOWN GAP.** Before any outside player's agent runs:
   - the published terms and privacy text must state what is captured (owner-reviewed; a text change bumps the version and re-consents, 0153 and 0155);
   - the erase-by-life and erase-by-owner procedures are written in `open-signup.md`;
   - the gap is registered with geldar-registration, and account deletion (0262) gains a telemetry erasure step.

4. **Shared-tenant gap (owner-level).** The SigNoz instance on the node belongs to another tenant. Per-life erasure is impossible inside it: only TTL expiry or a heavy ClickHouse mutation can remove data. Its OTLP ports are published without an ingestion key. **We do not change that tenant's configuration.** Geldar data reaches SigNoz only through our authenticated Caddy route. That route needs the owner's approval with the exact config, requested via geldar-93, before any node change.

5. **Retention and budget.** Traces, logs and metrics in the Geldar database are kept one year, under a hard TTL. The Geldar ClickHouse budget is 100 GB.
   - Alarm at 70% of that budget (70 GB) for the Geldar database.
   - A node-wide alarm when `/mnt/nvme` passes 60%.
   - If the size estimate grows past 100 GB, stop and tell the operator; do not raise the budget.
   - The survey estimate is 0.1 to 0.15 GB per day after compression, which is about 37 to 55 GB a year. The actual SigNoz TTL settings are unverified (the metadata directory is root-only).

6. **Readers: operator-only.** No public route serves SigNoz or any telemetry view. Claude's access is the SigNoz MCP server with a viewer-role key held on the owner's workstation only. The key is not in the repo, on the Colo or on any Mind host.

7. **Agents never see or infer telemetry.**
   - No telemetry vocabulary and no trace id in anything a model reads: prompts, skills, tool results, errors, chat, signs, file names, `.mcp.json`. The marker scan (0068, `contract/src/agent-text.ts`) gains the telemetry words (T-19).
   - Exporters are asynchronous, bounded and dropping, so export latency is not a side channel.
   - `TRACEPARENT` goes only in the supervisor's child environment, and only after a proof test on the pinned CLI (T-14): the header reaches the MCP, the model cannot read the variable, and the HC-26 test covers the new name. If the proof fails, the fallback is the neutral run-id header of the survey (section 3.2), not a file.
   - Propagate trace context only (`traceparent` and `tracestate`), never Baggage.

8. **Principle 1.** Telemetry and alerts are read-only. No dashboard, exporter, alert or automation may act in the world: no RCON, no teleport, no plan, no chat. Alert channels notify operators only.

9. **Node.**
   - One Geldar Collector on the Colo with caps of 0.5 CPU, 512 MiB memory and 128 pids (0082).
   - No raw `docker.sock` mount in any telemetry container (0260). Container stats come from read-only cgroup reads or a read-only stats proxy.
   - The NATS monitor is scraped only for `/varz` and `/jsz`. Never `/subsz` or connection subscriptions (`docs/runbooks/kino.md`).
   - Mind hosts reach the Colo through an authenticated OTLP endpoint on Caddy (bearer token). This amends 0071 and 0096, adds a public ingress, and needs owner approval before any node change.
   - Paper runs the OpenTelemetry Java agent plus Geldar-Core tick metrics, after a scratch-shard overhead test (MSPT and heap at 20, 10 and 5 TPS, with and without the agent).

10. **Substitution record.** SigNoz replaces spec 7's Prometheus and Loki, as 0130 already decided. Spec 7's alert list is the minimum alert set: TPS under 12 for 5 minutes, bodies online under 80% for 10 minutes, daily token spend. The spec is not edited (0073); this record is the amendment for the owner's reconciliation.

## Consequences

Cards (from the telemetry survey, section 7; each card names its own owner approval and its own tests):

- T-01 Decision record: telemetry scope, attribute allow-list, content policy, retention, readers; amends 0088
- T-02 Geldar Collector on the Colo (contrib 0.164.0 by digest): `compose/colo-otel.yml` overlay and `deploy/otel/gateway.yaml`; caps 0.5 CPU, 512 MiB, 128 pids
- T-03 `@geldar/telemetry` package (JS SDK 3.0.0, api 1.10.0, OTLP proto exporters 0.300.0): SDK setup off when the endpoint is unset, W3C trace context only, split resources, bounded dropping queues, attribute allow-list with tests, NATS `injectTrace` and `extractTrace`
- T-04 Logs: reconcile with `phase1/host-logs-journald`; app-level OTLP logs by default; give the player host's connection lines `life_id` and a timestamp
- T-05 NATS client observability in `contract/src/nats-connect.ts`: status events as logs and `geldar_nats_status_total{type}`
- T-06 MCP: spans at T1 to T5, `traceparent` on Body requests, failure cause as `error.type`, a separate log allow-list, `wait` attributes and links, pg instrumentation without parameter values; replace the hand pusher
- T-07 Body: start telemetry in the players host; connection session spans and kick classes; mind-link extraction and spans; action, intent and reflex spans; record sink headers and queue metrics; speech hash; damage linked to the running action; internal-fault line with ids; the endpoint variable reaches both Body launch paths
- T-08 eventsink: header extraction, batch spans with links, DLQ as error logs and metrics, lag gauge; migration adding nullable `events.trace_id`
- T-09 NATS server metrics: exporter in the NATS network namespace, `/varz` and `/jsz` only
- T-10 Postgres metrics: monitoring role, `postgresql` receiver in the Collector; `pg_stat_statements` only with a Postgres restart
- T-11 Paper Java agent 2.33.1 on the scratch shard first: pinned jar by checksum, every instrumentation off except the API bridge, JVM runtime metrics and the log4j appender; overhead measured at 20, 10 and 5 TPS
- T-12 Geldar-Core tick and world metrics through a bundled, unrelocated `opentelemetry-api` 1.67.0 (no-op without the agent): tick histogram, TPS, chunks and entities per world, publisher counts; NATS header propagation for block owner and hearing
- T-13 Kit: supervisor `mind.run` span and the stream-to-GenAI exporter (one parser shared with HC-41a); per-host Collector beside the player containers; content per decision point 2
- T-14 Kit and MCP: `TRACEPARENT` per run in `childEnv`; first prove on CLI 2.1.310 that outbound MCP requests carry the header; MCP extracts `_meta` then header; HC-26 test extended to the new name
- T-15 Mind-host to Colo transport: authenticated OTLP endpoint (Caddy route with a bearer token); amends 0071 and 0096 and the portscan expected list
- T-16 Optional: Claude Code native OpenTelemetry in the kit child (metrics and events, no prompt text, no tool details) to the host Collector
- T-17 Dashboards and alerts as code (`deploy/signoz/`): spec 7 alerts plus `body_unavailable` rate, lost-session ratio, DLQ written, audit records dropped, NATS reconnects, eventsink lag, Paper memory and MSPT, data absence per service; V1 dashboard JSON until the shared SigNoz is 0.135 or later
- T-18 Claude access: SigNoz MCP server pinned to a release tested against the node's SigNoz version; a viewer-role key (workstation-only secret); a query cookbook runbook
- T-19 Leak tests: telemetry vocabulary scan over tool results, error texts, prompts and kit files; no trace id in any tool result
- T-20 Retire the four hand-written OTLP pushers after T-06, T-07 and T-08 reach parity; keep the 0088 metric names

Exemptions: edits to the scriptorium repo, the Body (golem) and the MCP are each granted per card by the owner. This record grants none of them by itself.

Open items:

- **ClickHouse disk budget**: 100 GB with a hard TTL and the alarms in decision point 5; the actual TTL settings on the node are unverified.
- **Alert channel**: not chosen. Alerts go to operators only (decision point 8).
- **Shared-tenant risks**: the other tenant's stack has no CPU or memory limits and no `memory_limiter`; its OTLP ports are open without an ingestion key (decision point 4); its version is too old for V2 dashboards; per-life erasure is impossible inside it (decision point 3).
- **Owner approvals still needed**: the Caddy OTLP route with its exact config (decision point 4, via geldar-93); the public ingress amendment to 0071 and 0096 (decision point 9).
