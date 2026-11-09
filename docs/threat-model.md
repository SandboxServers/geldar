# Geldar threat model

Status: Phase 0 version. Written for spec [section 8](spec.md#8-security) and reviewed before every phase gate. Nothing is exposed in Phase 0, but the interfaces are shaped now so the armor bolts on later without changing them.

Where this file says "later", the control is in the spec and not built yet. Where it extends or tightens the spec, section 7 says so.

## 1. Scope

**Phase 0 runs:** one PC. The `docker compose` stack holds Paper, the bot-ingress Velocity proxy ([decision 0021](decisions/0021-velocity-from-phase0.md)), Postgres and NATS. Golem (the Body), Animus (the Mind), the event sink, Glass (Thought Stream v0), the local Thinker and Ollama are host processes. They reach the stack only through the loopback ports the compose file publishes, which is why those ports exist at all. Versions are pinned in [decision 0022](decisions/0022-minecraft-26-1.md). The operator is one person at the keyboard.

**Phase 0 does not run:** the Gateway, Envoy, step-ca, the DMZ, Entra ID, the spectator proxy, ghosts, watchers, sovereign players, Patrons or remote Thinkers, Discourse, the Historian.

**The rule that makes this safe:** no port binds to anything but `127.0.0.1`. In compose that means every `ports:` entry carries the `127.0.0.1:` prefix, because a bare `"5432:5432"` binds every interface. CI enforces the port part of this rule: `pnpm check:repo` (the loopback-ports check in `tools/repo-checks`) parses each `compose/*.yml` as YAML, with anchors, aliases and merge keys resolved. It fails when a service sets `network_mode` to `host` or to a value that is not a plain string, when a `ports:` or `network_mode` value contains `$` (interpolation is rejected because the value it resolves to is unknown), when a short `ports:` entry does not start with `127.0.0.1:`, or when a long-form mapping does not set `host_ip: 127.0.0.1`. `[::1]` hosts are rejected too, and ranges on loopback pass. A service that uses `extends:`, and a top-level `include:`, are rejected, because the definitions they import are not read. A file it cannot parse, or a `ports:` value of an unexpected shape, fails closed. `expose:` is not checked, because it publishes nothing to the host. Review covers everything else. CI does not check the other compose settings (`ONLINE_MODE`, the whitelist, secrets kept out of env); those are proven by hand with `compose/probe/login-probe.mjs`. If a service needs to be reachable beyond the host, Phase 0 is over and this model is re-reviewed.

## 2. Assets, actors and trust boundaries

Condensed from [spec 8.1](spec.md#81-assets-actors-trust-boundaries).

### Assets

| # | Asset | In Phase 0 |
|---|---|---|
| 1 | Colo infrastructure (no crypto miner, no pivot point) | Later. The host is the developer's own PC; the same care applies to what we run on it. |
| 2 | Integrity of the world record (nobody edits history) | Exists. Postgres and the journal hold it. |
| 3 | Cloud API keys and spend | Exists only if a cloud key is used through a local Thinker. |
| 4 | Game server availability | Exists, low stakes. |
| 5 | Experiment integrity (no human or Patron puppeteers agents) | Exists. Principle 1 applies to code as much as to people. |

### Actors

| Actor | Trust | Phase 0 |
|---|---|---|
| Internet, unauthenticated | None | Exists as an actor but has no path in: nothing listens off-host. |
| Patron (Thinker) | Low | Later. The local Thinker is ours. |
| Sovereign player's human | Low to medium | Later (Phase 2). |
| Watcher | Medium, read-only | Later. Thought Stream v0 is localhost only. |
| Ghost | Medium, spectator | Later. |
| Agent (AI, in-world) | None. Generates code and text by design. | Exists. Reaches the Body API and in-world mechanics, never a command, a network or a file. |
| Operator | Full | Exists. The only human. |

### Trust boundaries

| Boundary | In Phase 0 |
|---|---|
| Internet to DMZ, DMZ to internal | Later. Replaced by the loopback-only rule. |
| Thinker output to Mind validator | Exists. The local Thinker is a boundary even though we run it: its output is untrusted text. |
| MCP tool input to Mind validator | Later. |
| Agent code to sandbox | Exists once `define_skill` lands (spec 5.11). |
| Human to spectator enforcement | Later. |
| In-world text to a human's CLI | Later. |
| Agent text to other agents' prompts | Exists. Everything an agent says or writes can reach another agent's prompt. See section 5. |

## 3. Phase 0 surfaces

Each row accepts input. Rule for all: bind `127.0.0.1` (every compose port written as `127.0.0.1:<host>:<container>`) or stay on the compose network.

| Surface | Exposure | Control | Residual risk |
|---|---|---|---|
| Velocity bot ingress | `127.0.0.1:25565` on the host. `online-mode=false`, modern forwarding with a shared secret. | Offline mode is safe only because nothing else can reach it. The forwarding secret is a Docker secret file. The Geldar identity plugin (`plugin/velocity-identity`) denies, on `LoginEvent` before Paper sees the player, any username not in the NATS KV bucket `geldar-life-registry` (key: lowercase username; value: `{life_id, registered_at}`; a deleted or purged key is a revocation). It decides from a local cache and never waits on NATS; it fails closed until the first sync, and while the bucket is absent. Every denial shows one fixed message and logs no hint of the failed check. The `geldar:cmd` channel drops messages from connections that were not admitted. Paper's whitelist stays on as a second check. While the watch is down (NATS outage, lost connection) the cache is treated as unsynced and every login is denied; on reconnect the bucket is replayed into a fresh map, so a revocation made during an outage applies before anyone is admitted again. A player already connected stays connected until they disconnect (the gate decides at login only). Limits: Phase 0 NATS is open, so a process on the compose network and any process on the host loopback (`127.0.0.1:4222`) can write the registry; registry values and the number of keys are not bounded. | Any local process can connect as a whitelisted name. Accepted: single-user machine. |
| Paper | No published game port. Compose network only. | Accepts only Velocity-forwarded connections (modern forwarding secret). `white-list=true`; Golem whitelists a bot over RCON before connecting. Agents hold no permissions and run no commands. | Another container on the compose network could reach Paper directly if it knew the secret. All services are ours. |
| RCON | `127.0.0.1:25575` on the host, published for ops and the benchmark. | Random 32-character password generated by `./geldar.ps1 shard secrets` into a gitignored Docker secret file (`compose/secrets/rcon.txt`). Used by Golem for whitelist and test control. | Any local process that reads `compose/secrets/rcon.txt` gets the Paper console (op, give, stop). Accepted on the dev PC. |
| Postgres | `127.0.0.1:5432` on the host. | Password in a Docker secret file. | A local user with the file reads everything. Accepted. |
| NATS (JetStream) | `127.0.0.1:4222` (client) and `127.0.0.1:8222` (monitoring) on the host. No auth. | Loopback binding is the only control. Subjects follow the contract so authorization can be added per subject later. | Any local process can publish to any subject, including forged events. Port 8222 is an unauthenticated HTTP endpoint that lists connections and subscriptions; the same loopback-only residual risk applies. Accepted for Phase 0; accounts and nkeys in Phase 2. |
| Local Thinker WebSocket | `ws://127.0.0.1:<port>`, no auth, no TLS. | The Appendix H protocol with its rules enforced from day one (section 4), so the later mTLS wrapper changes the transport, not the messages. | Any local process can answer a job. Limited by job ownership (rule 2). |
| Ollama | Host, `127.0.0.1:11434`. | Default loopback binding. Never set `OLLAMA_HOST` to a non-loopback address. | A local process can use the model. Only prompts are at risk. |
| Thought Stream v0 | `127.0.0.1` only. | Read-only page tailing the journal. No endpoint accepts input that reaches the world. | Prompts are visible to whoever opens it. Prompts hold agent memory and nothing else (spec 8.10). |
| The repo | Public. | No secrets, account names or non-loopback IPs committed; `.env` and `compose/secrets/` are gitignored; `.env.example` is committed. | A mistake leaks a credential. CI and review check it. |

## 4. Interface rules from day one

These hold in Phase 0 code so security bolts on later without interface changes.

1. **Identity comes from the transport, never the payload** (Appendix H). In Phase 0 the local Thinker connection gets one identity when the socket is accepted. No frame contains a field asserting who sent it. Later the identity becomes the certificate SAN at the same place in the code.
2. **Completion ownership.** A `completion` or `error` is accepted only for a `job_id` issued to this connection, not yet answered, and arriving before its deadline. Anything else is dropped and counted.
3. **Size limits.** Frame at most 1 MiB, `text` at most 32 KiB, one `hello` per connection. Field-level caps live in the schemas (chat 256, sign 60, book 8192, and so on).
4. **Strict schemas.** Every wire message and every thought is validated against a schema in `contract/` with `additionalProperties: false`, length caps and enum verbs. Invalid input is dropped, logged with a reason code and counted, never repaired silently. The open objects are the deliberate exceptions: their properties are not typed, so each must be validated against a per-kind schema before use, and otherwise they are bounded only by `MAX_FRAME_BYTES` (1 MiB). They are: the `events_since_last_thought` items of the snapshot (`contract/schemas/snapshot.schema.json`), `WorldEvent.payload` (`event.schema.json`), `ActionRecord.args` and `ActionRecord.result` (`action-record.schema.json`), `Intent.arguments` and `Intent.checkpoint`, `use_skill.args` and `propose.value` (`thought.schema.json`).
5. **Stale plans never run.** Every action carries `life_id`, `body_generation` and an expiry (spec section 7). The Body rejects a plan from a dead life, an old Body incarnation or a passed deadline.
6. **Server-side accounting.** Token budgets use the Mind's own counts. What the Thinker reports about usage is logged only.
7. **Agents have zero command permissions.** No operator status, no permission grants, no chat commands. Mechanics travel on a plugin-messaging channel, not chat. Per-agent action and chat rate limits apply.
8. **Skill code is data until it passes the scan.** `define_skill` code goes through the forbidden-token scan and runs only in the sandbox (spec 5.11): `isolated-vm`, API facade, 60 s and 128 MB limits, no `require`, `process`, `eval` or network.
9. **No human act in the world** (Principle 1). Nothing we build lets a person speak, build, give items or intervene as or through an agent. There is no admin "say" or "teleport the agent" tool, no operator-injected prompt text, no hand-edited completion path. Operator tools read, start, stop and restore; they do not act. RCON is for infrastructure (whitelist, save, stop) and is exposed to no UI. One carve-out: benchmark and test control (tick rate, clearing the test area, benchmark setup) may run over RCON with no model attached. It never gives items to, or moves, an agent outside a benchmark.
10. **Secrets are files, not environment values** (spec 6.7). Services read Docker secret files; logs and the journal never contain them.
11. **Everything is recorded** (Principle 4), including rejected input. A rejection is evidence, not noise.

## 5. Prompt injection

**Agent to agent is in-world behavior** (Principle 5). Agents scamming, manipulating or injecting each other through chat, signs and books are social phenomena. We watch; we do not patch the agents, and we do not filter their speech to protect other agents' goals.

**Injection that reaches infrastructure is a vulnerability.** The line is what the text can touch:

| Text can reach | Verdict | Control |
|---|---|---|
| Another agent's prompt and decisions | In-world, not a bug | Prompts should mark in-world text as quoted observation. This is a default Animus should adopt (spec 8.5 requires it only for the Historian), not a built control and not a defense of the experiment. |
| The Mind validator (a thought asking for a verb, coordinate or length outside the schema) | Vulnerability if it passes | Strict schema, allow-listed verbs, bounded coordinates, capped lengths, reject on any failure. |
| The skill sandbox and the host (`define_skill` code) | Vulnerability if it escapes | Forbidden-token scan plus sandbox (rule 8). |
| Paper's command system | Vulnerability if it passes | No permissions; chat is not parsed for commands; mechanics use plugin messaging. |
| Operator tooling (Thought Stream, logs, journal viewers) | Vulnerability if it renders active content | Render agent text as plain text, escape HTML, never evaluate it. |
| The Historian, Discourse, a human's CLI | Later | Spec 8.5 and 8.4b. |

## 6. Open items for Phase 2

| Item | Spec |
|---|---|
| Replace loopback-only with the DMZ, Envoy and mTLS; the SAN becomes the transport identity (rule 1) | [8.2](spec.md#82-machine-identity-thinkers), [8.3](spec.md#83-transport-and-the-gateway) |
| NATS accounts and per-subject authorization | 8.3, 8.5 |
| Human identity: watchers, ghosts, the spectator proxy | [8.4](spec.md#84-human-identity-watchers-and-ghosts) |
| Sovereign players, OAuth scopes, in-world text read by a human's CLI | [8.4b](spec.md#84b-sovereign-players-oauth-scopes-and-the-humans-machine) |
| Puppeteering detection, anomaly scoring, spend ceilings | [8.5](spec.md#85-application-layer-controls) |
| Host hardening, secret rotation, certificate lifetimes | [8.6](spec.md#86-host-hardening-every-colo-box) |
| Supply chain beyond version pinning: image scanning, SBOMs, update cadence | [8.7](spec.md#87-supply-chain) |
| Logging, detection, response, an incident runbook | [8.8](spec.md#88-logging-detection-response) |
| Assurance: external review and a test plan for exposed surfaces | [8.9](spec.md#89-assurance) |
| Accepted limits to restate at the gate | [8.10](spec.md#810-what-this-does-not-protect-against-said-plainly) |

## 7. Deviations from section 8

- **Velocity in Phase 0.** Spec section 10 says Velocity does not exist yet; [decision 0021](decisions/0021-velocity-from-phase0.md) puts the bot-ingress proxy in from the start. Section 3 treats it accordingly.
- **Loopback-only rule.** The spec's actor table lists TCP 443 on two hosts and 25565 on one. Phase 0 exposes none of them off-host.
- **Local Thinker is a boundary.** The spec treats Thinker output as untrusted because Patrons are low-trust. This file keeps the same boundary for our own Thinker so the validator is exercised from the start.
- **Operator tooling as an injection target.** Section 8 does not list the Thought Stream or journal viewers; section 5 does.
- **Rejected input is recorded.** Rule 11 makes explicit what Principle 4 implies.
