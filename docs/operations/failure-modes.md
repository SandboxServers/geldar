---
title: Failure modes
type: reference
audience: agents-never
status: draft
last_verified: 2026-11-16 against 03c1f5de
companions: [README.md, ../runbooks/incident-response.md, ../reference/components.md, ../runbooks/README.md, ../runbooks/backup-and-restore.md, node-facts.md, ../architecture/deployment-topology-colo.md, ../concepts/world-operations-exceptions.md]
sources: [../reference/components.md, ../reference/golem-body.md, ../reference/animus-mind.md, ../reference/player-core.md, ../reference/psyche-engine.md, ../reference/mcp-tools.md, ../reference/register-service.md, ../reference/eventsink.md, ../reference/lantern-thinker-protocol.md, ../reference/supervisor-and-body-helper.md, ../reference/geldar-core-plugin.md, ../reference/velocity-identity-plugin.md, ../reference/third-party-plugins.md, ../reference/compose-stacks.md, ../reference/deploy-scripts.md, ../reference/admin-service.md, ../reference/database-schema.md, ../reference/cli-tools.md, ../reference/repo-checks.md, ../reference/contract-schemas.md, ../architecture/deployment-topology-colo.md, ../architecture/network-and-trust-zones.md, ../runbooks/colo-deploy.md, ../runbooks/open-signup.md, ../runbooks/nats-auth-inplace.md, ../runbooks/maintenance-notice.md, ../runbooks/backup-and-restore.md, golem/README.md, golem/src/connection.ts, golem/src/bench/cli.ts, animus/src/loop/thinker-wait.ts, animus/src/loop/fallback.ts, animus/src/prompts/library.ts, animus/src/config.ts, player-core/src/validate/corrective.ts, psyche/src/sheet.ts, threshold/mcp/src/http/limits.ts, threshold/mcp/src/http/front.ts, threshold/mcp/src/world.ts, threshold/register/src/config.ts, eventsink/src/config.ts, eventsink/src/consumer.ts, lantern-local/src/main.ts, lantern-local/src/ollama.ts, supervisor/src/helper-client.ts, body-helper/src/service.ts, body-helper/src/sweep.ts, plugin/core/src/main/resources/config.yml, plugin/core/src/main/java/dev/geldar/core/GeldarCore.java, plugin/velocity-identity/src/main/java/dev/geldar/identity/RegistryClient.java, glass/src/config.ts, deploy/colo-admin.sh, compose/paper/paper-entrypoint.sh, bench/sheet/run.sh, telemetry/README.md, CLAUDE.md, docs/spec.md, ../decisions/0041-event-export-stream-and-sink.md, ../decisions/0071-public-endpoints-and-ports.md, ../decisions/0072-glass-and-bluemap-are-public.md, ../decisions/0084-colo-deploy-by-pull-with-a-project-scoped-script.md, ../decisions/0091-public-mcp-behind-caddy.md, ../decisions/0093-glass-hardening.md, ../decisions/0094-public-sites-read-only-through-caddy.md, ../decisions/0134-mind-is-a-profile-until-a-thinker-exists.md, ../decisions/0137-public-spectator-proxy-is-separate-and-online.md, ../decisions/0153-terms-consent-and-deletion-before-sign-up.md, ../decisions/0169-players-host-restart-policy.md, ../decisions/0212-golem-body-is-a-profile-adam.md, ../decisions/0260-body-container-control-by-host-helper.md, ../decisions/0339-journal-reset-one-time-exception.md, ../decisions/0350-telemetry-scope-and-full-capture.md, ../decisions/0352-telemetry-dedicated-clickhouse-database.md]
---

# Failure modes

One table per Geldar component: what you see, the likely cause, the safe first action, the document to follow, what not to do, and how far the failure reaches. The component list is the one in [components](../reference/components.md#component-list), plus the three runtime services that every stack runs (NATS, Postgres and Paper). To act on an incident, follow [incident response](../runbooks/incident-response.md).

This is operator material. Never copy or link it into anything an agent in the world reads (prompts, skills, kit files, tool text, `identity.md`, player repos, signs); see [documentation style](../agents/documentation-style.md#agents-never-learn-they-are-watched). Links marked **(a-n)** go to `agents-never` documents.

## How this page was built

- Commit `03c1f5de`, 2026-11-16 (UTC). Read-only: no node, VM, database or world was read (plan decision D8). Nothing here says what runs on the Colo node today.
- Most cells repeat the cited W2 reference document, which was checked against `1b114276`. Between `1b114276` and `03c1f5de` the only code change is the new `telemetry/` package and its lock and release-date lines (`git diff --name-only 1b114276 03c1f5de -- . ':!docs'`, 32 files), so those facts still apply to `03c1f5de`. Cells that repeat a reference document were not re-checked in code for this page.
- Figures marked **(re-checked)** were read in the named code file at `03c1f5de` on 2026-11-16.
- None of the safe first actions or recoveries has been run for this page. Treat every one as untested.
- "Blast radius" says who notices: one Body, every Body, sovereign players, public viewers, the deploy, or developers only.

Columns, the same in every table:

| Column | Meaning |
|---|---|
| What you see | The symptom an operator or a log shows |
| Likely cause | The cause the cited code or document names |
| Safe first action | A read-only look, or the narrowest documented switch |
| Follow | The runbook or reference that holds the steps |
| Avoid | Actions to avoid. A cell that cites a rule (R1 to R8), a decision or a file names what that source forbids; a cell with no citation is this page's advice, not a recorded rule |
| Blast radius | Who is affected |

## Rules that apply to every row

These come from existing runbooks and decisions. They are repeated here so each "Avoid" cell can stay short.

| # | Rule | Evidence |
|---|---|---|
| R1 | No human acts in the world: never teleport, hand-fix, give items, place or break blocks, or edit an agent's memory. A world-operations exception is the owner's order, one time, with a decision record. | [spec 2](../spec.md#2-principles) principle 1; [spec 11](../spec.md#11-runbook) ("Never teleport or hand-fix"; "just drop one diamond: No"); [0339](../decisions/0339-journal-reset-one-time-exception.md); [world-operations exceptions](../concepts/world-operations-exceptions.md) |
| R2 | Never `docker compose down -v`. Never remove or recreate the Colo network. | [open-signup](../runbooks/open-signup.md#global-rules-every-step) rule 3; `deploy/colo-down.sh` keeps volumes ([deploy-scripts](../reference/deploy-scripts.md#colo-downsh-and-colo-statussh)) |
| R3 | Never run `./geldar.ps1 shard nats-auth` on the node, never restart NATS, and never `mv` a file over the live NATS config. Change NATS in place with a SIGHUP. | [open-signup](../runbooks/open-signup.md#global-rules-every-step) rule 4; [nats-auth-inplace](../runbooks/nats-auth-inplace.md) "Facts" and "Notes" |
| R4 | Paper recreates and whole-stack `up` need the owner's agreed window. `deploy/colo-up.sh` is both; never run it for a single step. | [open-signup](../runbooks/open-signup.md#global-rules-every-step) rules 5 and 10 |
| R5 | Never print or paste a secret value. | [open-signup](../runbooks/open-signup.md#global-rules-every-step) rule 2; persona rule 3 |
| R6 | No Docker socket in any container. | [0260](../decisions/0260-body-container-control-by-host-helper.md); open-signup rule 6 |
| R7 | Never start the Mind (`animus`) or the idle Adam Body (`golem-body`) on the Colo by hand. | [0134](../decisions/0134-mind-is-a-profile-until-a-thinker-exists.md); [0212](../decisions/0212-golem-body-is-a-profile-adam.md) |
| R8 | `bench` and `test:live` mutate the shard; run them alone, one at a time. Never run `adam up` before live cases. | `CLAUDE.md` |

## Contract

`contract/`: JSON Schemas, generated code and subject builders ([contract-schemas](../reference/contract-schemas.md)). No runtime of its own; it fails inside the services that import it.

| What you see | Likely cause | Safe first action | Follow | Avoid | Blast radius |
|---|---|---|---|---|---|
| CI or `./geldar.ps1 check` fails at "generated code" | A schema changed without regeneration, or generated code was edited by hand | Read the drift output; regenerate from the schema | [generator and drift check](../reference/contract-schemas.md#generator-and-drift-check) | Edit generated code (`CLAUDE.md`, "Change the contract, never the generated code") | Developers only |
| The Mind logs a `BodyLinkError`; events a consumer expected never arrive | A message failed the contract: the Mind's Body link raises `BodyLinkError` for a bad reply, and the event source drops and counts events that fail it | Compare the producer's and consumer's image commits; a mixed deploy is the usual cause | [player-core modules](../reference/player-core.md#modules); [colo-deploy](../runbooks/colo-deploy.md) | Loosen a schema to make a live message pass | The lives whose messages fail |

## Golem (Body)

`golem/`: the bot client ([golem-body](../reference/golem-body.md)). The reference has no failure section ([gap](#gaps-this-page-records)); rows below are from `golem/README.md` and code.

| What you see | Likely cause | Safe first action | Follow | Avoid | Blast radius |
|---|---|---|---|---|---|
| A Body exits at once with an error naming `GELDAR_NATS_URL` | The life registry is off, so Velocity kicked it with "This connection is not admitted." (`golem/README.md`, "Life registry") | Check that the Body's environment sets `GELDAR_NATS_URL` | [velocity-identity-plugin](../reference/velocity-identity-plugin.md#how-a-login-is-decided) | Whitelist the name by hand to get round the gate | One Body |
| A Body goes fatal after repeated "not admitted" kicks | With the registry on, 5 such kicks in a row go fatal (`MAX_NOT_ADMITTED = 5` in `golem/src/connection.ts`, **re-checked**); the gate was closed, usually because NATS or the registry bucket was down | Check the Velocity readiness and NATS rows below first | [NATS](#nats); [Velocity identity plugin](#velocity-identity-plugin) | Restart NATS (R3) | Every Body that reconnects in that window |
| A Body connects then fails its first connect with a NATS error naming host and port | NATS unreachable at first connect: the connection goes fatal with no connect attempt (`golem/README.md`) | Check NATS | [NATS](#nats) | Restart NATS (R3) | One Body, or all if NATS is down |
| After a restart, the Body idles and logs a reason (`no_checkpoint`, `checkpoint_unreadable`, `other_life`, `expired`, `unknown_program`, `resume_failed`, `tick_unknown`) | `restartBody` could not resume the saved intent; a `no_plan` wake follows after 45 s; `tick_unknown` keeps the checkpoint and is not retried | Read the reason; nothing to fix unless the reason repeats | [golem-body, deploy, operate and retire](../reference/golem-body.md#deploy-operate-and-retire); `golem/README.md` "Checkpoints and restarts" | Edit the checkpoint bucket by hand | One Body |
| Body logs `auditDropped` or dropped records | The record queue filled while NATS was away: audit records go oldest first, reflex and wake records are shed first, and a record that can never be sent is dropped alone (`golem/README.md`, "The Body") | Check NATS and JetStream health | [NATS](#nats); [eventsink](#eventsink) | Replay records by hand | The record of one Body; the world is unaffected |
| An agent repeats the same action and does not move | Agent behaviour, or a verb that does not do what it says. Spec 11 says a watchdog injects a `stuck` event and restarts the Body after 3 cycles; the snapshot carries a `stuck` field (`contract/schemas/snapshot.schema.json` line 64) and `golem/src/actions/pathing.ts` has a stall watchdog (600 ticks by default), but the 3-cycle restart was not found in this pass: unverified | Read the action outcomes and failure reasons in the Body log | [outcome and failure reasons](../reference/golem-body.md#outcome-and-failure-reasons) | Teleport, hand-fix, give items (R1). A verb defect is an infrastructure fix in code, not in the world | One agent |
| A managed player host keeps restarting, with a growing `RestartCount` | A crash loop: `unless-stopped` has no restart cap, and Docker backs off between restarts (decision [0342](../decisions/0342-body-hosts-unless-stopped.md); decision [0169](../decisions/0169-players-host-restart-policy.md) had a cap of five) | `deploy/colo-admin.sh player-list`; read that host's log | [colo-deploy, per-player host containers](../runbooks/colo-deploy.md#per-player-host-containers) | Touch other players' containers | One sovereign player |
| After a node reboot, some player hosts are down or not in game | A host stopped by hand (`player-stop`) stays down, as intended. A host whose start failed at boot (restart policies ignore `depends_on`, so it may start before NATS or Paper is ready) stays idle until a presence record arrives (decision [0342](../decisions/0342-body-hosts-unless-stopped.md)) | `deploy/colo-admin.sh player-list`; `RestartCount` in the runbook's reboot check | [colo-deploy, after an unattended reboot](../runbooks/colo-deploy.md#after-an-unattended-reboot): check each host is in game; for each that is down run `colo-admin.sh player-start <id>`, and for each that is up but not in game run `colo-admin.sh player-stop <id>` then `player-start <id>` (`player-start` alone leaves a running host as it is) | Run `colo-up.sh` to bring them back (R4) | Every sovereign player |

Known gap: the managed Body entry point differs between decision 0261, a comment in `body-helper/src/template.ts` and the code ([golem-body conflict 4](../reference/golem-body.md#conflicts-recorded)).

## Body benchmark

`golem/src/bench/`, run by `./geldar.ps1 bench` on a developer machine against the local Phase 0 shard.

| What you see | Likely cause | Safe first action | Follow | Avoid | Blast radius |
|---|---|---|---|---|---|
| The local shard is left at a low tick rate or with the bench whitelist entry | A run was killed before its cleanup | `./geldar.ps1 bench --restore` restores the world and 20 TPS (`golem/src/bench/cli.ts` lines 283 to 286, **re-checked**) | [cli-tools, body benchmark](../reference/cli-tools.md#body-benchmark-and-live-tests); `body-bench` skill | Run `bench` and `test:live` at once (R8) | The local shard only |
| A run prints "server was at N TPS: restoring 20" | A previous run left the rate changed; the bench resets it before starting (`cli.ts` lines 288 to 292, **re-checked**) | None | same | Point the bench at the Colo (it uses the local Phase 0 stack only; [components](../reference/components.md#lifecycle-deploy-to-retirement)) | The local shard only |

## Animus (Mind)

`animus/`: frozen; on the Colo it sits behind profile `mind` and is not started (decision [0134](../decisions/0134-mind-is-a-profile-until-a-thinker-exists.md)). The reference has no failure section ([gap](#gaps-this-page-records)); rows below are from code. These apply to a desktop `adam up` run.

| What you see | Likely cause | Safe first action | Follow | Avoid | Blast radius |
|---|---|---|---|---|---|
| The Mind exits at start with a config error (shard name, tier, life id, model pin, digest placeholder, empty password file) | `animus/src/config.ts` throws on each of these (lines 137 to 308, **re-checked**) | Read the error; fix the shard file or `.env` | [animus-mind configuration](../reference/animus-mind.md#configuration); [shard-config](../reference/shard-config.md) | Write a digest that was not read from `ollama list` | The local Adam run |
| The Mind exits at start with a prompt template error (missing block, unexpected block, bad file) | `createPromptLibrary` loads and checks every template at start and throws (`animus/src/prompts/library.ts` line 161, **re-checked**) | Check `mind.thought_version` names a template that exists | [Prompts](#prompts) | Edit a released template to make it load (`CLAUDE.md`) | The local Adam run |
| Thoughts stop; the log shows `no_thinker` | No Thinker connected: one call waits up to `mind.thinker_wait_s` (default 20, `animus/src/config.ts` line 216, **re-checked**) and retries once; then the fallback continues the interrupted intent or holds (`animus/src/loop/thinker-wait.ts`, `fallback.ts`) | `./geldar.ps1 adam status`; `adam logs lantern-local` | [lantern-local](#lantern-local) | Run `adam up` before live cases (R8) | One Adam life |
| Fewer thoughts than expected | The admission cap per real hour (`mind.admission.max_thoughts_per_real_hour`; a reflection costs 2) | Read the admission lines in the log | [animus-mind limits](../reference/animus-mind.md#limits) | Raise the cap mid-run without a recorded change | One Adam life |

## player-core

`player-core/`: a library inside the MCP and the Mind; no process of its own. The reference has no failure section ([gap](#gaps-this-page-records)).

| What you see | Likely cause | Safe first action | Follow | Avoid | Blast radius |
|---|---|---|---|---|---|
| A model's output is refused, then retried once with a corrective message | Strict validation failed (schema, allow-list, bounds); the corrective message lists at most 5 errors and echoes at most 512 characters (`player-core/src/validate/corrective.ts`, **re-checked**) | None; this is designed behaviour | [player-core interfaces](../reference/player-core.md#interfaces) | Widen the allow-list to accept a verb the Body has no handler for ([allow-lists](../reference/player-core.md#allow-lists)) | One thought |
| `threshold/mcp/src/json-string-parity` test fails | `src/validate/json-string.ts` and `animus/src/prompts/world-text.ts` differ | Make the same change in both | [player-core change rules](../reference/player-core.md#change-rules) | Delete the parity test | Developers only |

## Psyche

`psyche/`: the character engine, copied into the Mind kit. The reference has no failure section ([gap](#gaps-this-page-records)).

| What you see | Likely cause | Safe first action | Follow | Avoid | Blast radius |
|---|---|---|---|---|---|
| A process logs "character sheet refused: ..." | A malformed sheet throws and names the field; it is never repaired (`psyche/src/sheet.ts` line 82, **re-checked**; decision 0281 point 5) | Read which field; the database baseline wins over a config sheet | [psyche-engine rules](../reference/psyche-engine.md#rules-from-decision-0281) | Repair a sheet by hand in the database (append-only and immutable triggers, [database triggers](../reference/database-schema.md#triggers)) | One life |
| The release test fails | `psyche/src` and `psyche/RELEASE.json` disagree | `node tools/psyche-release/src/cli.ts --write` after a deliberate change | [releasing a change](../reference/psyche-engine.md#releasing-a-change-under-psychesrc) | Hand-edit `RELEASE.json` | Developers; the kit pin |

Known gap: the tag `psyche-v1.1.0` named in `RELEASE.json` did not exist on 2026-11-16 ([psyche-engine open item 1](../reference/psyche-engine.md#conflicts-and-open-items-recorded)).

## Threshold MCP

`threshold/mcp/`: the MCP server for sovereign players ([mcp-tools](../reference/mcp-tools.md)). The reference lists refusals and error codes but no failure section ([gap](#gaps-this-page-records)).

| What you see | Likely cause | Safe first action | Follow | Avoid | Blast radius |
|---|---|---|---|---|---|
| Every request answers 503 `unavailable` | The kill switch `public.kill_switch` is on (read at start; [0091](../decisions/0091-public-mcp-behind-caddy.md) item 4), the token store failed, or 16 token lookups were in flight (`MAX_LOOKUPS_IN_FLIGHT = 16` in `threshold/mcp/src/http/limits.ts`, **re-checked**) | Check the shard file's `public:` block and the Postgres row | [HTTP refusals](../reference/mcp-tools.md#http-refusals); [Postgres](#postgres) | Turn the switch off without knowing why it was set | Every sovereign player |
| Players get 401 for every call | Missing, malformed, unknown, revoked or expired token, or an owner over cap or retired; the reason is logged only ([token refusal reasons](../reference/mcp-tools.md#token-refusal-reasons)) | Read the logged refusal reason | [mcp-tokens](../runbooks/mcp-tokens.md) **(a-n)** | Mint a token outside `mcp-tokens` or the register service | One player or owner |
| Tool calls return `body_unavailable` ("Your body is waking...") | The player's Body is not reachable (`threshold/mcp/src/world.ts` line 63, **re-checked**) | Check the player host (Golem rows above) | [Golem](#golem-body) | Start a host with a raw `docker run`; use `deploy/colo-admin.sh player-start` | One player |
| Many 429 `rate_limited` | Rate gates per player, per owner and per address ([rate limits](../reference/mcp-tools.md#rate-limits-and-caps)) | None; designed behaviour | same | Raise limits on the live shard without a decision | One player or owner |
| Public MCP must stop now | Abuse or a defect | `deploy/colo-public.sh off mcp`, then restart the MCP container ([0091](../decisions/0091-public-mcp-behind-caddy.md) item 4) | [incident response](../runbooks/incident-response.md) | Restart the shared Caddy outside a window ([conflict](#conflicts-recorded) 2) | Every sovereign player |

Known gaps: whether the server runs on the node is unverified ([mcp-tools conflict 10](../reference/mcp-tools.md#conflicts-recorded)); the spec's global failed-auth limit does not exist (conflict 11).

## MCP mock

`threshold/mcp-mock/`: not deployed by any compose file or script ([components](../reference/components.md#lifecycle-deploy-to-retirement)).

| What you see | Likely cause | Safe first action | Follow | Avoid | Blast radius |
|---|---|---|---|---|---|
| The `mcp-mock-image.yml` job or `./geldar.ps1 pnpm test threshold/mcp-mock` fails | A change to the mock or the shared contract | Read the test output | [ci-workflows](../reference/ci-workflows.md#mcp-mock-imageyml) | Change the mock's prompts without the agent-text rules: its prompts reach players through the real server ([mcp-tools](../reference/mcp-tools.md#agent-visible-text)) | Developers; players only if the prompt text changes |

## Register

`threshold/register/`: sign-in, owners, players, tokens ([register-service](../reference/register-service.md)).

| What you see | Likely cause | Safe first action | Follow | Avoid | Blast radius |
|---|---|---|---|---|---|
| `/register/` answers the service's own 503 | `REGISTER_KILL_SWITCH` is on: anything but exactly `false` keeps it on (`threshold/register/src/config.ts` line 155, **re-checked**). This is the closed state | None unless the owner has opened sign-up | [open-signup](../runbooks/open-signup.md) | Set it to `false` without the owner's written yes ([open-signup owner gate](../runbooks/open-signup.md#owner-gate); [0153](../decisions/0153-terms-consent-and-deletion-before-sign-up.md)) | New sign-ins |
| Register fails at start naming a variable | A required `*_FILE` missing or too short, `REGISTER_PUBLIC_URL` not `https://`, a CIDR in `REGISTER_TRUSTED_PEERS` ([configuration names](../reference/register-service.md#configuration-names)) | Read the error | same | Put a secret value in an env var instead of a file (R5) | New sign-ins and the owner API |
| Body and retire routes answer 404 on the Colo | `compose/colo.yml` sets no `REGISTER_NATS_*`, so they are not mounted ([register-service](../reference/register-service.md#configuration-names)) | None; known state | [open-signup, pending](../runbooks/open-signup.md#pending-as-first-written-the-merged-on-main-bullet-lists-what-has-merged-since) | Add NATS users outside the in-place procedure (R3) | Owners using the API |
| An owner action fails with 500 and `audit_lost` | The `register_audit` write failed, which fails the request ([database interface](../reference/register-service.md#database-interface)) | Check Postgres | [Postgres](#postgres) | Disable the audit trigger | Owners |
| Account deletion returns 503 and removes nothing | A Body stop failed before the delete ([account deletion](../reference/register-service.md#account-deletion-and-export)) | Retry later; check the supervisor and helper | [account-deletion](../runbooks/account-deletion.md) **(a-n)** | Delete rows by hand outside `register_account_delete` | One owner |

Known gaps in code: no body status line, token not held for `/onboarding`, `display` stored as `microsoft`, `/roster` answers 404 ([known gaps in code](../reference/register-service.md#known-gaps-in-code)); `PATCH` cannot pass Caddy (conflict 7 there).

## Glass and Kino

`glass/`: read-only viewing surfaces for humans (spec section 3). Failure detail is in [glass-and-kino, failure modes](../reference/glass-and-kino.md#failure-modes) **(a-n)**; this page stays at the level of the decisions.

| What you see | Likely cause | Safe first action | Follow | Avoid | Blast radius |
|---|---|---|---|---|---|
| Glass errors or does not start | See the (a-n) reference | `deploy/colo-public.sh status` | [glass-and-kino](../reference/glass-and-kino.md#failure-modes) **(a-n)** | Give the Glass role write grants | Public viewers |
| Glass must stop now | Defect or exposure | `deploy/colo-public.sh off glass` (Caddy swap, decisions [0072](../decisions/0072-glass-and-bluemap-are-public.md), [0094](../decisions/0094-public-sites-read-only-through-caddy.md)); or `GELDAR_GLASS_ENABLED=false` and a restart ([0093](../decisions/0093-glass-hardening.md); `glass/src/config.ts` line 143, **re-checked**) | [incident response](../runbooks/incident-response.md) | None recorded | Public viewers; `glass-off.caddy` also covers the register paths ([register-service](../reference/register-service.md#build-test-and-deploy)) |
| Kino must stop | Defect or exposure | The kill switch in [kino](../runbooks/kino.md#kill-switch) **(a-n)** | same | None recorded | Kino viewers |

## Eventsink

`eventsink/`: copies `GELDAR_EVENTS` into Postgres ([eventsink](../reference/eventsink.md#failure-modes)).

| What you see | Likely cause | Safe first action | Follow | Avoid | Blast radius |
|---|---|---|---|---|---|
| Events stop appearing in Postgres; the sink naks | Postgres down: events wait in the stream with no redelivery cap (`MAX_DELIVER = -1`, `eventsink/src/consumer.ts` line 52, **re-checked**) until the 30-day age limit (`retentionDays: 30`, `eventsink/src/config.ts` line 18, **re-checked**) | Check Postgres | [Postgres](#postgres); [eventsink monitor](../reference/eventsink.md#monitor) | Delete the durable consumer | Every reader of the `events` table |
| Old events vanish from the stream before they were stored | The stream reached 2 GiB and JetStream dropped the oldest (`maxBytes`, `eventsink/src/config.ts` line 19, **re-checked**). Limits apply when the stream is created; an existing stream keeps its own (same file, lines 10 to 12) | Check stream size and the sink's pending count | [eventsink](../reference/eventsink.md#failure-modes) | Recreate the stream to change limits without the owner (it drops what is not stored) | Event history |
| One ALERT line and a DLQ entry | A poison message | Replay steps in `eventsink/README.md` | same | None recorded | One event |
| The sink fails before connecting | Bad `GELDAR_PROFICIENCY_THRESHOLDS` | Read the error | [eventsink configuration](../reference/eventsink.md#configuration) | Enable the sheet overlay while the sheet hold stands ([sheet RESUME](../analysis/sheet/RESUME.md)) | Event copy stops |

Known gaps: nothing prunes the `events` table; decision 0041's redelivery cap of 20 differs from the code ([eventsink conflict 1](../reference/eventsink.md#conflicts-and-open-points)). Two sink replicas can race; compose runs one.

## lantern-local

`lantern-local/`: the local Thinker for a desktop Adam run. No Thinker path exists on the Colo ([lantern-thinker-protocol](../reference/lantern-thinker-protocol.md#on-the-colo)).

| What you see | Likely cause | Safe first action | Follow | Avoid | Blast radius |
|---|---|---|---|---|---|
| lantern-local exits 1 with `fatal:` at start | No pinned model's digest matches Ollama (`lantern-local/src/main.ts` line 56, **re-checked**; [client behaviour](../reference/lantern-thinker-protocol.md#client-behaviour-lantern-local)) | `./geldar.ps1 adam models` | [lantern-thinker-protocol](../reference/lantern-thinker-protocol.md) | Record a digest you did not read from Ollama | The local Adam run |
| Jobs fail with `model_unavailable` | Ollama not reachable, or HTTP 404 for the model (`lantern-local/src/ollama.ts` lines 112 to 114, **re-checked**) | Check Ollama on loopback | same | None recorded | The local Adam run |
| Jobs fail with `internal` `context overflow` | The prompt reached `num_ctx` | Read the Mind's prompt budget | [animus-mind](../reference/animus-mind.md#prompt-use) | None recorded | One thought |

Known gap: by default the Thinker hub accepts any local process, because nothing sets `GELDAR_THINKER_TOKEN_FILE` ([configuration](../reference/lantern-thinker-protocol.md#configuration); `docs/threat-model.md`).

## Supervisor

`supervisor/`: answers body control subjects ([supervisor-and-body-helper](../reference/supervisor-and-body-helper.md#operate-fail-and-retire)). No compose file runs it at `03c1f5de` (conflict 1 there).

| What you see | Likely cause | Safe first action | Follow | Avoid | Blast radius |
|---|---|---|---|---|---|
| A body start answers `timeout` and records no row | The supervisor's 20 s bound (`HELPER_TIMEOUT_MS = 20_000`, `supervisor/src/helper-client.ts` line 13, **re-checked**); the helper may still finish within its 120 s deadline (`body-helper/src/service.ts` line 32, **re-checked**) | Read `status` before any retry | [operate, fail and retire](../reference/supervisor-and-body-helper.md#operate-fail-and-retire) | Retry a start without reading `status` | One owner's Body |
| Body starts refused as `quota` | Supervisor quotas ([quotas](../reference/supervisor-and-body-helper.md#quotas)) | None; designed behaviour | same | Raise the global cap above decision 0261's 40 Bodies ([open-signup](../runbooks/open-signup.md#global-rules-every-step) rule 8) | One owner |

## Body helper

`body-helper/`: root-owned host service that starts and stops Body containers (decision [0260](../decisions/0260-body-container-control-by-host-helper.md)).

| What you see | Likely cause | Safe first action | Follow | Avoid | Blast radius |
|---|---|---|---|---|---|
| Body containers exist that are not on the roster | The sweep only reports them (`body-helper/src/sweep.ts`); a reap path is a later card | Report them; check the roster | [operate, fail and retire](../reference/supervisor-and-body-helper.md#operate-fail-and-retire) | Remove containers by pattern; stop only named containers | Node resources |
| The helper unit will not install or start | Bundle digest mismatch, missing env file, or the pinned Node tarball digest does not match (`deploy/install-body-helper.sh` steps 1, 1b, 1c) | Run the install script without `--apply` (dry run) | [body-helper-node-steps](../runbooks/body-helper-node-steps.md) | Mount the Docker socket into a container instead (R6); run `shard nats-auth` (R3) | Managed Bodies cannot start |

## Geldar-Core plugin

`plugin/core/`: the Paper plugin ([geldar-core-plugin](../reference/geldar-core-plugin.md#failure-modes)).

| What you see | Likely cause | Safe first action | Follow | Avoid | Blast radius |
|---|---|---|---|---|---|
| Paper stops during start | Enable threw: bad shard name, unwritable readiness marker, any `RuntimeException` (`enableOrStop`, `GeldarCore.java` line 41, **re-checked**) | Read the Paper log for the exception | [deploy and rollback](../reference/geldar-core-plugin.md#deploy-and-rollback): previous jar and a Paper restart | Restart Paper outside the owner's window (R4) | Whole world |
| `server_tps` shows `dropped` and `connected: false` | NATS down: events queue up to `queue.capacity` (10000 in `plugin/core/src/main/resources/config.yml` line 7, **re-checked**), then the oldest is dropped; core-NATS messages are dropped | Check NATS | [NATS](#nats) | Restart NATS (R3) | Event history; hearing and notices |
| Block owner queries answer unknown | CoreProtect absent or older than API 12 | Check the CoreProtect jar | [coreprotect](../runbooks/coreprotect.md); [block-owner](../runbooks/block-owner.md) | None recorded | Ownership records |
| Players see a maintenance line at the wrong time, or must not see any | A notice was published | Set `maintenance.broadcast: false`; the plugin re-reads it every 5 s | [maintenance-notice](../runbooks/maintenance-notice.md#switching-it-off) | Publish a notice with the plugin's own credentials | Every player online |

Plugin changes are "needs manual" in a CD run ([colo-deploy](../runbooks/colo-deploy.md#needs-manual)).

## Velocity identity plugin

`plugin/velocity-identity/`: the bot-ingress gate ([velocity-identity-plugin](../reference/velocity-identity-plugin.md#failure-modes)).

| What you see | Likely cause | Safe first action | Follow | Avoid | Blast radius |
|---|---|---|---|---|---|
| Every login denied; Velocity unhealthy | `GELDAR_NATS_URL` unset, or NATS down, or the registry bucket absent: the gate fails closed and removes its readiness marker | Check NATS | [NATS](#nats); [readiness and health](../reference/velocity-identity-plugin.md#readiness-and-health) | Turn the gate off or open it by config | Every Body |
| Logins fail for up to 30 s after the bucket was recreated | The bucket identity is checked every 30 s (`BUCKET_CHECK_MS = 30_000`, `RegistryClient.java` line 51, **re-checked**) | Wait 30 s | same | Recreate the bucket to "fix" a login | Every Body |
| Skins missing | Skins bucket missing: default profile (fail open for skins only) | `deploy/colo-admin.sh ensure-skins-bucket` | [skins](../runbooks/skins.md) **(a-n)** | None recorded | Appearance only |

Known gap: the public overlay against decision 0137, recorded in decision [0364](../decisions/0364-known-gap-public-overlay-against-0137.md). A deleted watch consumer alone is not detected.

## Third-party plugins

`plugins/`: BlueMap, Chunky and CoreProtect pins ([third-party-plugins](../reference/third-party-plugins.md)). The reference has no failure section.

| What you see | Likely cause | Safe first action | Follow | Avoid | Blast radius |
|---|---|---|---|---|---|
| `colo-up.sh` refuses during the plugin step | A downloaded jar does not match its lock file digest (`fetch_*` in `deploy/common.sh`; [deploy-scripts](../reference/deploy-scripts.md#commonsh-functions)) | Read the refusal; check the lock file | [coreprotect](../runbooks/coreprotect.md), [chunky](../runbooks/chunky.md) | Skip the digest check | The deploy |
| Server lag during pregeneration | Chunky load | Pause or slow Chunky | [chunky](../runbooks/chunky.md) | None recorded | Whole world |
| The public map shows a 503 page | The map site is off (`map-off.caddy`) | `deploy/colo-public.sh status` | [map-chat-panel](../runbooks/map-chat-panel.md) **(a-n)** | None recorded | Public viewers |

## NATS

The bus every stack runs (compose services; [nats-topology](../architecture/nats-topology.md)).

| What you see | Likely cause | Safe first action | Follow | Avoid | Blast radius |
|---|---|---|---|---|---|
| Velocity unhealthy, Bodies cannot log in, the plugin drops events | NATS down or unreachable | `deploy/colo-status.sh` (read-only) | [nats-auth-inplace](../runbooks/nats-auth-inplace.md) | Restart NATS, run `shard nats-auth` on the node, `mv` over the live config (R3); probe the monitor port ([compose-stacks conflict 4](../reference/compose-stacks.md#conflicts-recorded)) | Every Body and every NATS client |
| `Permissions Violation` errors after a config change | A user lost a permission in a reload; whether a reload closes live sessions is not verified ([client impact](../runbooks/nats-auth-inplace.md#client-impact)) | Read the NATS log since the change | [nats-auth-inplace](../runbooks/nats-auth-inplace.md): restore the backup by `cat`, check the sha, SIGHUP | same | The changed users' clients |
| A compose or plan step prints `needs manual: NATS config` | The CD never applies NATS config ([colo-deploy](../runbooks/colo-deploy.md#needs-manual)) | Read the plan | [nats-auth-inplace](../runbooks/nats-auth-inplace.md) | same | None until applied |

Known conflict: three runbooks gave conflicting ways to create NATS users ([runbooks index, overlaps](../runbooks/README.md#overlaps-and-duplicates) **(a-n)** item 2). The in-place SIGHUP procedure is the one the deploy and open-signup runbooks follow.

## Postgres

One database per shard ([database-schema](../reference/database-schema.md)). See also [Database](#database) for schema faults.

| What you see | Likely cause | Safe first action | Follow | Avoid | Blast radius |
|---|---|---|---|---|---|
| The sink naks, Glass answers `internal error`, the MCP answers 503, owner actions fail | Postgres down or out of connections | `deploy/colo-status.sh` | [deployment-topology-colo](../architecture/deployment-topology-colo.md#rollback-and-stop); [backup-and-restore](../runbooks/backup-and-restore.md#while-no-backup-exists) | `down -v` (R2); restore one store alone ([spec 11](../spec.md#11-runbook), "Never restore one component alone"; decision [0076](../decisions/0076-backup-scope-and-destination.md)) | Every service with a database |

## Paper

The Minecraft server.

| What you see | Likely cause | Safe first action | Follow | Avoid | Blast radius |
|---|---|---|---|---|---|
| TPS low in `server_tps` events | Spec 11 names too many bots pathfinding, entity cramming, a skill in a tight loop. spark is bundled in Paper (`compose/paper/paper-entrypoint.sh` line 62, **re-checked**); no repo runbook gives its commands | Look before you change anything | [spec 11](../spec.md#11-runbook) "Server lag" | Remove entities or move agents by hand (R1) | Whole world |
| Paper will not start after a deploy | A plugin enable threw ([Geldar-Core](#geldar-core-plugin)), or a jar bind source became a directory (`colo-up.sh` refuses this; [failure modes this layout guards against](../architecture/deployment-topology-colo.md#failure-modes-this-layout-guards-against)) | Read the Paper log | [geldar-core-plugin](../reference/geldar-core-plugin.md#deploy-and-rollback) | Recreate Paper outside the owner's window (R4) | Whole world |

## Compose, shards and envs

`compose/`, `shards/`, `envs/` ([compose-stacks](../reference/compose-stacks.md), [shard-config](../reference/shard-config.md)). The reference has gates and known gaps but no failure section.

| What you see | Likely cause | Safe first action | Follow | Avoid | Blast radius |
|---|---|---|---|---|---|
| `shard up` refuses before starting | A plugin jar the compose file mounts is missing, or the colo NATS secret files are absent ([shard actions](../reference/cli-tools.md#shard-actions)) | `cd plugin; ./gradlew build` | [cli-tools](../reference/cli-tools.md#shard-actions) | `shard up colo` on the node to work round it | The stack being started |
| `shard up` fails after start | Paper did not log `Geldar-Core enabled` or Velocity did not log `Geldar identity enabled` | `./geldar.ps1 shard logs <name>` | [Geldar-Core](#geldar-core-plugin); [Velocity](#velocity-identity-plugin) | None recorded | The stack being started |
| `./geldar.ps1 check` fails at the Colo config step | `shards/colo.yaml` totals below the per-service budgets, or a non-loopback bind ([check steps](../reference/cli-tools.md#check-steps)) | Read the step output | [shard-config](../reference/shard-config.md) | None recorded | Developers |

Known gaps: the public overlay against 0137 (see Velocity); `deploy/compose.secrets.yml` still names two removed register secrets ([compose-stacks conflict 2](../reference/compose-stacks.md#conflicts-recorded)).

## Deploy

`deploy/` scripts and the `colo-deploy` workflow ([deploy-scripts](../reference/deploy-scripts.md), [colo-deploy](../runbooks/colo-deploy.md)).

| What you see | Likely cause | Safe first action | Follow | Avoid | Blast radius |
|---|---|---|---|---|---|
| A CD run exits 1 with nothing restarted | A pull, src refresh, dump or migration failed first; the previous manifest is restored (`abort_untouched`) | Read the job summary and `cd.log` in the state directory | [colo-cd.sh](../reference/deploy-scripts.md#colo-cdsh-delta-deploy-cd-2a) | Re-run at once without reading the log | None |
| A CD run exits 1 after restarts | A health check failed; services already restarted are put back on the previous release | Read the summary; `deploy/colo-status.sh` | same | Assume the database rolled back: migrations are forward-only | The restarted services |
| The summary lists `needs manual` items | Plugin, compose, Caddy or NATS changes, or a failed player-host refresh | Read every item before closing the deploy | [colo-deploy, needs manual](../runbooks/colo-deploy.md#needs-manual) | Apply compose or NATS changes with `colo-up.sh` mid-window (R4) | Depends on the item |
| A release must be undone | A bad release | `deploy/colo-rollback.sh` (re-applies the previous record with `--pull never`) | [colo-deploy rollback](../runbooks/colo-deploy.md#rollback) | Expect it to undo migrations; use a tag instead of a digest ([0084](../decisions/0084-colo-deploy-by-pull-with-a-project-scoped-script.md) item 4) | The whole stack |
| `colo-up.sh` or `colo-cd.sh` refuses | Missing secret file, wrong mode or owner, a published 25565 or 25566, an undigested image, a jar path that is a directory, a second deploy holding the lock ([deploy-scripts](../reference/deploy-scripts.md#commonsh-functions)) | Read the refusal; fix the named item | same | Bypass the check | The deploy |

Known gaps: two manifest copies kept in step by hand, so a missed step can leave rollback on an older release ([deployment-topology conflict 5](../architecture/deployment-topology-colo.md#conflicts-recorded)); the node-side entrypoint is outside the repo and unverified.

## Admin service

`tools/admin/`, `deploy/colo-admin.sh`, one-shot container ([admin-service](../reference/admin-service.md#exit-codes)).

| What you see | Likely cause | Safe first action | Follow | Avoid | Blast radius |
|---|---|---|---|---|---|
| `colo-admin.sh` exits 1 | Any refusal or failed run; the CLI's own exit code is not passed through | Re-run with dry run where offered; read stderr | [exit codes](../reference/admin-service.md#exit-codes) | Run the admin CLI with a hand-made `docker run` | The one admin task |
| `admin.sh` exits 1 at once | The Postgres password file is missing or empty | Check the secret file exists, by name only (R5) | [admin-service](../reference/admin-service.md) | Print the file | The one admin task |
| `player-start` prints that it cannot set the restart policy | `docker update` failed; a running host keeps no restart policy until it is stopped with `player-stop` and started again with `player-start` (0169 item 7) | Note it; in a quiet moment run `player-stop <id>` then `player-start <id>`, which sets `unless-stopped` (`player-start` alone leaves a running host as it is) | [colo-deploy](../runbooks/colo-deploy.md#per-player-host-containers) | None recorded | One player host |

Known gaps: `roster remove` and `roster seed` cannot run through the container; the superuser password default differs between two files ([conflicts and gaps](../reference/admin-service.md#conflicts-and-gaps-recorded)).

## Database

`sql/` migrations ([database-schema](../reference/database-schema.md)). The reference has no failure section ([gap](#gaps-this-page-records)).

| What you see | Likely cause | Safe first action | Follow | Avoid | Blast radius |
|---|---|---|---|---|---|
| A migration fails during a CD run | SQL error; the CD wrote a `pg_dump` to the state directory's `backups/` before migrating, and aborts with nothing restarted ([colo-cd.sh](../reference/deploy-scripts.md#colo-cdsh-delta-deploy-cd-2a) step 7) | Read `cd.log` | [how migrations apply](../reference/database-schema.md#how-migrations-apply) | Edit a merged migration (`sql/README.md`) | The deploy |
| Every account deletion fails and rolls back | `register_account_delete` (0040) needs `sheet_erase_life` (0051) ([account deletion](../reference/database-schema.md#account-deletion-register_account_delete-0040)) | Check `schema_migrations` for 0051 | [account-deletion](../runbooks/account-deletion.md) **(a-n)** | Delete rows by hand | Owners asking for deletion |
| UPDATE or DELETE refused on a journal, receipt, audit or sheet table | Append-only triggers (0007, 0025, 0050, 0051) | None; designed behaviour | [triggers](../reference/database-schema.md#triggers) | Disable a trigger or change `session_replication_role` (decision 0085); 0339 was a one-time owner-ordered exception | The table's history |
| An admin check answers false | `register_is_admin` fails closed to false | Check Postgres | [register-service](../reference/register-service.md#database-interface) | None recorded | One owner |
| The `events` table keeps growing | Nothing prunes it | Watch disk | [data retention](../reference/database-schema.md#data-retention-and-erasure) | Delete events by hand | Disk |

Known gaps: whether migrations through 0065 (and 0006, the owner cap trigger) are applied on the node is unverified; several migration headers disagree with later migrations ([conflicts and open points](../reference/database-schema.md#conflicts-and-open-points)).

## Prompts

`prompts/`: versioned Mind templates ([prompt-templates](../reference/prompt-templates.md) **(a-n)**). The reference has no failure section ([gap](#gaps-this-page-records)).

| What you see | Likely cause | Safe first action | Follow | Avoid | Blast radius |
|---|---|---|---|---|---|
| The Mind will not start: a template error | A template is missing, has a missing or unexpected block, or a bad file (`animus/src/prompts/library.ts`, **re-checked**) | Check the version the shard file names | [Animus](#animus-mind) | Edit a released template in place (`CLAUDE.md`, "Prompt changes go in `prompts/` with a version bump") | The Mind |
| The agent-text test fails | A template contains text an agent must not read (`animus/src/prompts/agent-text.test.ts`; decision 0068) | Read the test output | [documentation style, paths an agent reads](../agents/documentation-style.md#paths-an-agent-reads) | Delete or weaken the test | Developers; agents if it ships |

## Tools

`tools/` CLIs ([cli-tools](../reference/cli-tools.md)). No reference has a failure section for them.

| What you see | Likely cause | Safe first action | Follow | Avoid | Blast radius |
|---|---|---|---|---|---|
| A `./geldar.ps1` pass-through exits non-zero | The child's exit code is passed through; an unknown command exits 2 | Read the child's stderr | [behaviour shared by every command](../reference/cli-tools.md#behaviour-shared-by-every-command) | None recorded | The caller |
| A command changed shared state unexpectedly | Some commands touch the shard, database or NATS ([commands that change shared state](../reference/cli-tools.md#commands-that-change-shared-state)) | Check that table before running a command | same | Run shard-changing commands in parallel (R8) | Depends on the command |

## CI and repo checks

`.github/workflows/`, `tools/repo-checks/` ([ci-workflows](../reference/ci-workflows.md), [repo-checks](../reference/repo-checks.md)).

| What you see | Likely cause | Safe first action | Follow | Avoid | Blast radius |
|---|---|---|---|---|---|
| A gate fails in `pnpm check:repo` | The gate's own failure line names it ([gates](../reference/repo-checks.md#gates-in-pnpm-checkrepo)) | Read the line | same | Add an exemption without a reviewed change (`CLAUDE.md`, file caps) | The PR |
| `./geldar.ps1 check` passes but CI fails | CI runs jobs `check` does not (`sql`, `images`, `integration`, Caddy validate) ([cli-tools conflict 3](../reference/cli-tools.md#conflicts-recorded)) | Read the failing job | [ci-workflows](../reference/ci-workflows.md) | None recorded | The PR |
| A merged PR does not deploy | `colo-deploy` runs only after a successful `colo-images` run on `main` ([colo-deploy](../runbooks/colo-deploy.md#how-a-deploy-runs)) | `gh run list --workflow colo-images.yml --branch main` | [colo-deploy](../runbooks/colo-deploy.md); [merge-queue](../runbooks/merge-queue.md) | Dispatch a commit not on `main` (the job refuses it) | The deploy |

## Telemetry

Decisions [0350](../decisions/0350-telemetry-scope-and-full-capture.md) and [0352](../decisions/0352-telemetry-dedicated-clickhouse-database.md). At `03c1f5de` a shared package `telemetry/` exists, off unless a collector URL is set, and no service imports it (`git grep -l "@geldar/telemetry"` outside `telemetry/` finds only two documents, 2026-11-16). Its README says it never blocks and drops items when its queue is full (`telemetry/README.md`, "Operator notes"). Detail: [telemetry-pipeline](../architecture/telemetry-pipeline.md) **(a-n)**.

| What you see | Likely cause | Safe first action | Follow | Avoid | Blast radius |
|---|---|---|---|---|---|
| No traces or metrics | Nothing is switched on (0350, Context) | None | [monitoring-and-vitals](monitoring-and-vitals.md) **(a-n)** | Point a service at a collector without the owner's step approval (0352, "Who decides") | Diagnosis only |

## Sheet driver

`bench/sheet/run.sh`: scratch-shard driver for the sheet campaign.

| What you see | Likely cause | Safe first action | Follow | Avoid | Blast radius |
|---|---|---|---|---|---|
| Exit 1 "refused by the guard" | `SHEET_SHARD` or `SHEET_PROJECT` does not start with `scratch-`, or is a live name (`bench/sheet/run.sh` lines 3 to 4, 13, **re-checked**) | Use a scratch name | [scratch-stack](../runbooks/scratch-stack.md) | Point it at a live shard; turn on sheet features while the owner's hold stands ([sheet RESUME](../analysis/sheet/RESUME.md)) | None |
| Exit 1 from `leak` | A capture contains sheet numbers | Treat as a finding; keep the capture operator-only | same | None recorded | Agent-visibility |

## Docs library

`docs/`.

| What you see | Likely cause | Safe first action | Follow | Avoid | Blast radius |
|---|---|---|---|---|---|
| A runbook gate test fails | Five tests read runbook text ([repo tests that read runbooks](../runbooks/README.md#repo-tests-that-read-runbooks) **(a-n)**) | Read the test | [doc-update map](../agents/doc-update-map.md) | Paste a secret-shaped value to satisfy wording | The PR |
| A broken link or stale page | No gate checks links or metadata | Run the scans | [doc verification](../agents/doc-verification.md) | None recorded | Readers |

## Gaps this page records

1. **Seven reference documents have no failure-modes section**: [golem-body](../reference/golem-body.md), [animus-mind](../reference/animus-mind.md), [player-core](../reference/player-core.md), [psyche-engine](../reference/psyche-engine.md), [mcp-tools](../reference/mcp-tools.md), [database-schema](../reference/database-schema.md) and [prompt-templates](../reference/prompt-templates.md) **(a-n)** ([components gap 3](../reference/components.md#gaps-this-page-records)). The tables above for those seven are built from code read on 2026-11-16 and from the references' other sections. Each reference should link its row here.
2. **Others without one**: lantern-thinker-protocol, contract-schemas, third-party-plugins, compose-stacks, shard-config, cli-tools, ci-workflows and repo-checks have no section named "Failure modes" (`grep` for failure headings in `docs/reference`, 2026-11-16). This page covers them from their other sections.
3. **No alerting.** Spec 8.8 lists alerts; nothing in the repo sends them ([incident response](../runbooks/incident-response.md#what-spec-88-asks-for-and-what-exists)).
4. **No backup or restore procedure** in the repo. Decision [0076](../decisions/0076-backup-scope-and-destination.md) chooses a coordinated checkpoint, not built; [backup-and-restore](../runbooks/backup-and-restore.md) records that none exists. The only copy the repo takes is the CD's `pg_dump` before a migration.
5. **Node state.** Every "Known gap" above is a repo fact. What the node runs was not read (D8).
6. **Stuck agents.** The spec 11 watchdog restart after 3 cycles was not found in code: unverified.

## Conflicts recorded

Recorded, not resolved (persona rule 8).

1. **Spec kill switches against the repo.** Spec 8.8 names `geldar thinker revoke`, `geldar gateway drain` and `geldar shard freeze`. `git grep` for those three outside `docs/spec.md` finds nothing (2026-11-16 at `03c1f5de`). The switches that exist are per service: see [incident response](../runbooks/incident-response.md#4-contain-pick-the-narrowest-switch).
2. **Caddy reload or restart.** Decision [0071](../decisions/0071-public-endpoints-and-ports.md) item 6 and `deploy/caddy/README.md`: reload, never restart. `deploy/README.md` and `colo-public.sh` `restart` mode: one operator restart per change, because the admin API is off (owner ruling R39, not a decision record). Both are recorded in [network-and-trust-zones conflict 3](../architecture/network-and-trust-zones.md#conflicts-recorded).
3. **Sign-up switch wording.** Decision [0153](../decisions/0153-terms-consent-and-deletion-before-sign-up.md) Context says "the kill switch is on by default"; its point 3 says "the kill switch stays off" until the gate opens. Code: `killSwitch: env.REGISTER_KILL_SWITCH !== 'false'` (on unless exactly `false`), and the open-signup runbook keeps it `true` until the owner's yes. Point 3 reads as the opposite of the code; recorded, not resolved.
