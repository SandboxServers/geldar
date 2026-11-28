---
title: Shard config
type: reference
audience: operators
status: draft
last_verified: 2026-11-16 against 1b114276
companions: [README.md, compose-stacks.md, environment-variables.md, glossary.md, ../concepts/time-shards-and-phases.md, ../runbooks/scratch-stack.md, ../architecture/deployment-topology-colo.md, contract-schemas.md]
sources: [shards/phase0.yaml, shards/colo.yaml, shards/colo-mind.yaml, shards/character-fixture.yaml, envs/environment.schema.json, envs/test.example.yaml, contract/schemas/shard-config.schema.json, geldar.ps1, animus/src/config.ts, golem/src/adam/adam-config.ts, golem/src/body/reflex-config.ts, golem/src/players/player-config.ts, golem/src/players/main.ts, golem/src/character/character-config.ts, threshold/mcp/src/cli.ts, threshold/mcp/src/config.ts, deploy/colo-admin.sh, tools/repo-checks/src/colo-services.test.ts, threshold/mcp/src/config-public.ts, lantern-local/src/config.ts, tools/adam-cli/src/cli.ts, tools/mcp-tokens/src/players.ts, tools/genesis-env/src, tools/repo-checks/src/env-definitions.ts, tools/repo-checks/src/identity-mode.ts, compose/colo.yml, compose/phase0.yml, docs/spec.md, ../decisions/0188-genesis-environment-stamp.md, ../decisions/0131-colo-in-container-hosts-and-mind-shard-file.md, ../decisions/0082-colo-compose-network-and-limits.md, animus/src/attention/controller.ts, animus/src/loop/admission.ts, animus/src/memory/retrieval.ts, animus/src/prompts/library.ts, animus/src/reflection/reflect.ts, bench/sheet/scratch-shard.template.yaml, contract/schemas/character-sheet.schema.json, golem/src/bench/sheet/scratch-template.test.ts, player-core/src/loop/plan.ts, player-core/src/validate/bounds.ts, threshold/mcp/src/config-read.ts, threshold/mcp/src/presence.ts, threshold/mcp/src/tools/status.ts, threshold/mcp/src/tools/unavailable.ts, threshold/mcp/src/tools/wait.ts, threshold/mcp/src/world-session.ts, tools/adam-cli/src/pins.ts, tools/adam-report/src/config.ts, tools/adam-run/src/manifest.ts]
---

# Shard config

Every key in the four shard files under `shards/` (the sheet campaign's template in `bench/sheet/` is listed but not broken down) and every property of the environment definition schema under `envs/`, with the code that reads each one. For what a shard is, see the [glossary](glossary.md) and [time, shards and phases](../concepts/time-shards-and-phases.md). For the compose files that mount these files, see [compose stacks](compose-stacks.md).

All facts were read from the files at commit `1b114276` on 2026-11-16. No value was read from the node.

## The files

| File | What it is | Who reads it | Evidence |
|---|---|---|---|
| `shards/phase0.yaml` | The Phase 0 shard: spec Appendix E trimmed to Phase 0, plus the Mind, model pins, embedding and sovereign blocks. | The Mind, Adam's Body, the player host, the MCP, `lantern-local`, `tools/adam-cli`, `tools/mcp-tokens` (each reads its own blocks; default shard is `phase0`). | Header comment lines 1 to 2; loaders below |
| `shards/colo.yaml` | The Colo budget file: four flat `key: value` lines (total CPU and memory, Minecraft port, bind address). | `geldar.ps1` (`Read-ColoConfig`), run by `./geldar.ps1 check` and `./geldar.ps1 shard up colo`. | `geldar.ps1` lines 69 to 138 |
| `shards/colo-mind.yaml` | The Colo Mind shard file: the same blocks as `phase0.yaml`, plus `public`. Mounted into the Colo containers as `/opt/geldar/shards/colo.yaml`. | `golem-body`, `animus`, `geldar-mcp`, `players-host` and `admin` in `compose/colo.yml`; `deploy/colo-admin.sh`. | Header lines 1 to 5; `compose/colo.yml` lines 271, 315, 365, 630, 684; decision [0131](../decisions/0131-colo-in-container-hosts-and-mind-shard-file.md) |
| `shards/character-fixture.yaml` | Disposable character fixtures: three Bodies with character sheets. Nothing starts from it unless a scratch stack is pointed at it. | The character and player loaders when a scratch run names it. | Header lines 1 to 4 |
| `envs/environment.schema.json` | JSON Schema (draft-07) for one genesis environment, `envs/<name>.yaml`. | `tools/genesis-env` and the `env-definitions` repo check. | Schema `description`; decision [0188](../decisions/0188-genesis-environment-stamp.md) |
| `envs/test.example.yaml` | A valid example environment with documentation addresses and placeholder digests. | `tools/genesis-env` (every `envs/*.yaml`). | Header lines 1 to 3 |
| `bench/sheet/scratch-shard.template.yaml` | Out of scope for the key tables below: a template, "not a shard file", that the sheet campaign operator copies to a `scratch-` shard in a scratch checkout and never commits. It has the shard shape (for example the `chat` block with `shout_enabled`). | Nothing reads it in place; `golem/src/bench/sheet/scratch-template.test.ts` parses it so it stays loadable. | Header lines 1 to 7 |

Re-derive the file list:

```powershell
git ls-files shards envs
```

## How a shard file is chosen

| Reader | File it opens | Evidence |
|---|---|---|
| The Mind (`animus`) | `shards/<GELDAR_SHARD>.yaml`, default `phase0`. Refuses a file whose `shard:` differs from `GELDAR_SHARD`. | `animus/src/config.ts` lines 96, 133 to 137, 272 |
| Adam's Body | `shards/<GELDAR_SHARD>.yaml`, default `phase0`. | `golem/src/adam/adam-config.ts` lines 125 to 129 |
| Player host | `shards/<GELDAR_SHARD>.yaml`, default `phase0`. | `golem/src/players/main.ts` line 67 |
| The MCP | The file argument, else `GELDAR_SHARD_FILE`, else `shards/<GELDAR_SHARD>.yaml`. | `threshold/mcp/src/cli.ts` line 73 |
| `lantern-local` | `shards/phase0.yaml`. | `lantern-local/src/config.ts` line 67 |
| `deploy/colo-admin.sh` | `GELDAR_COLO_SHARD`, default `shards/colo-mind.yaml`. | `deploy/colo-admin.sh` line 176 |
| Colo containers | `shards/colo-mind.yaml`, bind-mounted read-only as `/opt/geldar/shards/colo.yaml` with `GELDAR_SHARD=colo`. | `compose/colo.yml`; `tools/repo-checks/src/colo-services.test.ts` line 72 |

## `shards/phase0.yaml` and `shards/colo-mind.yaml`

The two files share one shape. The table gives each key, the value shape, its meaning (from the file's own comment), the reader, and where the two files differ. "Reader" names the loader that parses the key; "none found" means the read-only search below found no code that reads it.

Re-derive the readers of one key:

```powershell
git grep -lE '<key>' -- '*.ts' '*.ps1' ':!*.test.ts' ':!**/test/**' ':!*.generated.ts' ':!*.fakes.ts' ':!*fixture*' ':!docs'
```

### Top-level keys

| Key | Shape | Meaning | Reader | phase0 / colo-mind |
|---|---|---|---|---|
| `shard` | string | The shard name. Must equal `GELDAR_SHARD`. | `animus/src/config.ts`; `golem/src/adam/adam-config.ts`; `threshold/mcp/src/config.ts` line 190; `tools/mcp-tokens/src/players.ts` | `phase0` / `colo` |
| `seed` | integer | The world seed. The compose `SEED` of Paper must equal it ("keep them equal"). | None found in code; it is a comment-level contract with `compose/phase0.yml` line 64 and `compose/colo.yml` line 119 | Same in both |
| `tick_rate` | integer | Server ticks per second; 20 is the gate (decisions 0038, 0047). | `animus/src/config.ts` line 180; `golem/src/adam/adam-config.ts` (time scale = 20 / tick_rate); `threshold/mcp/src/config.ts` line 203 (1 to 200) | Same |
| `world_border_radius` | integer | Border radius in blocks; the world border command takes the diameter. | `animus/src/config.ts` line 182; `threshold/mcp/src/config.ts` line 204 (1 to 30000000); `player-core/src/validate/bounds.ts` | Differs: Phase 0 radius 1500; Colo radius 9500 (see [conflicts](#conflicts-recorded)) |
| `max_world_ticks` | integer | The largest `limits.max_world_ticks` an intent may ask for. | `animus/src/config.ts` line 183 | Same |
| `max_block_operations` | integer | The largest `limits.max_block_operations` an intent may ask for. | `animus/src/config.ts` | Same |
| `population_target` | integer | Spec Appendix E population target. | None found | Same |
| `identity_mode` | `unwatched` or `watched` | Whether humans may observe the shard (spec 5.14). A shard that allows sovereign players must be `watched`. | `tools/repo-checks/src/identity-mode.ts`; `tools/mcp-tokens/src/players.ts` | `watched` in both |
| `reflexes` | map of booleans | One flag per spec 5.2 reflex: `enabled` (master switch), `eat`, `retreat`, `hazard_escape`, `fall_stop`, `fight_or_flee`, `blocked_path`, `panic_burrow`. | `golem/src/body/reflex-config.ts` through `golem/src/adam/adam-config.ts` line 117 | Same, all `true` |
| `body_actions` | map: `edit_sign`, `use`, `swim` | The Body's verb flags; a flag left out is off. | `golem/src/adam/adam-config.ts` lines 67 to 74, 118 to 120 | Differs: `use` is `false` in Phase 0, `true` on Colo (decision 0218) |
| `chat` | map: `radius`, `shout_enabled`, `rate_limit_seconds`, `max_chars` | Proximity chat settings. | `radius` and `max_chars`: `threshold/mcp/src/config.ts` lines 205 to 207; `rate_limit_seconds` and `max_chars`: `golem/src/adam/adam-config.ts` lines 112 to 113. `shout_enabled`: none found | Same |
| `memory` | map: `working_window`, `episodic_top_k`, `fatigue_days` | Mind memory sizes. | `animus/src/config.ts`; `animus/src/memory/retrieval.ts`; `animus/src/reflection/reflect.ts` | Same |
| `attention` | map: `min_wakeup_spacing_s`, `fallback_wakeup_ticks`, `overheard_to_digest` | Mind attention controller. | `animus/src/config.ts`; `animus/src/attention/controller.ts` | Same |
| `lifecycle` | map: `permadeath` | Whether death ends a life. | None found as a config read; `threshold/mcp/src/tools/status.ts` line 46 assumes permadeath is off in a comment (decision 0147) | Same, `false` |
| `models` | map of tier to list of model tags (`strong`, `fast`) | The model tags each tier may use. | `animus/src/config.ts` | Same |
| `model_pins` | map of model tag to `digest`, `num_ctx`, `keep_alive`, `max_concurrent` | Pinned models (decision 0051). A model whose digest differs is not advertised. The loaders refuse the placeholder digest `sha256:RECORD_AT_DISPATCH` outside tests. `num_ctx` is the context window (decision 0181). | `animus/src/config.ts`; `lantern-local/src/config.ts` lines 109 to 125; `tools/adam-cli/src/pins.ts`; `tools/adam-report/src/config.ts`; `tools/adam-run/src/manifest.ts` | Same digests |
| `embedding` | map: `model`, `digest`, `dims`, `on_cpu` | The embedding model and its pin; `on_cpu` keeps it off the GPU. | `animus/src/config.ts`; `lantern-local/src/config.ts` | Same |
| `public` | map: `trusted_proxies`, `client_ip_header`, `rate_limit` (`per_minute`, `burst`), `kill_switch` | Public surfaces behind the node's reverse proxy (decisions 0090, 0094). Each key left out falls back to the matching `sovereign.mcp` key, then to a default; no `public:` block means no per-client limit (decision 0091). | `threshold/mcp/src/config-public.ts` lines 40 to 70 | Colo only |
| `sovereign` | map, below | Sovereign players (spec 5.15; decisions 0040, 0041, 0052). | `threshold/mcp/src/config.ts` lines 198, 236 to 320; `golem/src/players/player-config.ts`; `tools/mcp-tokens/src/players.ts` | See below |
| `mind` | map, below | The Mind, the Thinker socket and Adam's identity. | `animus/src/config.ts`; `golem/src/adam/adam-config.ts`; `lantern-local/src/config.ts`; `tools/adam-cli/src/cli.ts` | See below |
| `character` | map: `mode` (`off` or `sheet`), `rolls`, `proficiency` (`enabled`, `thresholds` of three numbers) | The character engine. Commented out (inactive) in both files: `mode: off` builds nothing. | `golem/src/character/character-config.ts` (known keys `mode`, `rolls`, `proficiency`); `tools/mcp-tokens/src/players.ts` line 43 | Commented out in both |

### `sovereign` block

| Key | Shape | Meaning | Reader (all in `threshold/mcp/src/config.ts` unless named) |
|---|---|---|---|
| `allowed` | boolean | Whether sovereign players may be served; `false` refuses every one. | line 255 |
| `harnesses.<name>.enabled` | boolean per harness | Harness types the MCP accepts. Phase 0 names `claude`; Colo names `claude` and `chatgpt` (decision 0180). | `sovereignConfig` |
| `owner_cap_default` | integer, 0 to 50 | Sovereign players one owner may hold (spec 5.15.6). | line 257; `tools/mcp-tokens/src/players.ts` line 38 |
| `owner_cap_owner` | integer, 0 to 50 | The owner's own cap (decision 0052). | line 252; `tools/mcp-tokens/src/players.ts` line 40 |
| `mcp.port` | integer | The MCP's HTTP port; compose publishes it on `127.0.0.1` only. | `sovereignConfig` |
| `mcp.wait_cap_seconds` | integer | Clamp on `wait`'s `max_seconds`. | `sovereignConfig`; `threshold/mcp/src/tools/wait.ts` |
| `mcp.keepalive_seconds` | integer | Notification interval on an open `wait` stream. | `sovereignConfig`; `threshold/mcp/src/world-session.ts` |
| `mcp.max_body_bytes` | integer | Largest request body the MCP reads. | `sovereignConfig` |
| `mcp.max_result_bytes` | integer | Largest tool result after trimming. | `sovereignConfig` |
| `mcp.trusted_proxies` | list of addresses | Peers whose client-address header is trusted. Empty in both files. The MCP's effective list is `public.trusted_proxies` when that key is set (Colo sets it, `shards/colo-mind.yaml` line 40), else this key (`threshold/mcp/src/config-public.ts` lines 51 to 54). `GELDAR_MCP_TRUSTED_PROXIES`, when set, replaces that effective list (`threshold/mcp/src/config.ts` lines 373 to 376). This row is the one statement of the rule; [environment variables](environment-variables.md#mcp-thresholdmcp) links here. | line 260 |
| `mcp.client_ip_header` | string (optional) | Header naming the client address; read only from a trusted peer (decision 0090). Not set in either file. | comment `shards/phase0.yaml` lines 115 to 116 |
| `mcp.max_connections`, `mcp.max_connections_per_address` | integer (optional) | Connection caps; derived from `owner_cap_owner` when left out. Not set in either file. | comment `shards/phase0.yaml` lines 112 to 114 |
| `mcp.replay_minutes` | integer | How long a replayed or revoked token stays under watch. | `threshold/mcp/src/config-read.ts` |
| `mcp.show_unavailable_tools` | boolean | Whether tools the shard does not run are advertised. Colo only, `false`. | `threshold/mcp/src/tools/unavailable.ts` |
| `wake.min_spacing_seconds`, `wake.intent_run_too_long_seconds` | integer | Least gap between two wakes; an intent running longer wakes its player once. | lines 278 to 279 |
| `presence.lease_seconds`, `presence.hibernate_after_seconds`, `presence.start` | integer, integer, `on_demand` or `always` | Presence lease, hibernation delay, and when Bodies start. | lines 248 to 250, 282 to 286; `threshold/mcp/src/presence.ts` |
| `budget.credits_per_real_hour`, `budget.cap_credits` | integer | Credits a life accrues per real hour and the most it can hold (spec 5.7). | lines 293 to 294 |
| `rate_limits.calls_per_minute`, `act_min_seconds`, `say_min_seconds`, `journal_min_seconds`, `owner_calls_per_minute`, `failed_auth_per_minute`, `handshake_per_minute` | integer | Per-player, per-owner and per-address limits; `handshake_per_minute` is optional (default 300). | lines 297 to 318 |
| `players` | list of `{ player_id, life_id, name }`, optionally `character_sheet` | The sovereign players served. A life id is the player id with hyphens as underscores. The player host refuses an unlisted id. | line 320; `golem/src/players/player-config.ts` |

`players` holds 7 entries in `shards/phase0.yaml` and 20 in `shards/colo-mind.yaml` (counted 2026-11-16 at `1b114276`):

```powershell
(Select-String -Path shards/phase0.yaml -Pattern '^\s+- \{ player_id:').Count
(Select-String -Path shards/colo-mind.yaml -Pattern '^\s+- \{ player_id:').Count
```

### `mind` block

| Key | Shape | Meaning | Reader |
|---|---|---|---|
| `agent.name` | string | Display name in prompts and addressed-speech detection (decision 0051). | `animus/src/config.ts`; `golem/src/adam/adam-config.ts` line 110 |
| `agent.username` | string | The game account username, equal to the life id (decisions 0040, 0051, 0064). | both, above |
| `agent.tier` | `strong` or `fast` | The `models` tier for the life; fixed for the life (spec 5.3.3). | `animus/src/config.ts` |
| `agent.personality_seed` | string | The owner-approved seed (decision 0051). The Mind refuses an empty or placeholder seed. | `animus/src/config.ts` lines 153 to 156 |
| `agent.harness`, `agent.model` | string (optional) | A run stamp; not set in either file. | `golem/src/adam/adam-config.ts` lines 76 to 93 |
| `agent.character_sheet` | map (optional) | This life's character sheet. Not set in either file. | `golem/src/adam/adam-config.ts` line 36 |
| `thinker.host`, `thinker.port` | loopback address, integer | The Mind's Thinker socket (decision 0050). On Colo it is an explicit placeholder that nothing can reach until a Thinker gateway exists (decision 0078). | `animus/src/config.ts`; `lantern-local/src/config.ts` line 102 (loopback only) |
| `thinker.name` | string | The Thinker name in the welcome frame. Colo: `unreachable-placeholder`. | as above |
| `thinker.heartbeat_s`, `thinker.warm_timeout_s` | integer | Heartbeat interval; how long a pinned model may take to load. | `animus/src/config.ts`; `lantern-local/src/config.ts` |
| `snapshot_retry_s`, `thinker_wait_s` | integer | Retry window for a snapshot while the Body is down; wait for a Thinker before one retry. | `animus/src/config.ts` |
| `prompt_budget_tokens` | integer | Estimated tokens for a thought's user message; must fit `num_ctx` with the system message and the output cap. | `animus/src/config.ts`; `animus/src/prompts/library.ts` |
| `max_beliefs`, `max_commitments` | integer | Beliefs and commitments loaded into a prompt. | `animus/src/config.ts` |
| `thought_version` | integer | The thought template, `prompts/thought/v<N>.md`. | `animus/src/config.ts` |
| `thought.max_tokens`, `thought.temperature`, `thought.deadline_s`, `thought.reasoning` | integer, number, integer, `"on"` or `"off"` | Standard thought job settings (decision 0049 for `reasoning`). | `animus/src/config.ts` |
| `reflection.max_tokens`, `reflection.deadline_s`, `reflection.reasoning` | as above | Sleep reflection job settings (spec 5.4). | `animus/src/config.ts` |
| `admission.max_thoughts_per_real_hour` | integer | Local admission cap on thought jobs. | `animus/src/loop/admission.ts` |
| `plan.expires_after_ticks` | integer | World ticks after its snapshot before the Body refuses a plan. | `animus/src/config.ts`; `player-core/src/loop/plan.ts`; `threshold/mcp/src/config.ts` |
| `run_tier` | `strong` or `fast` | The tier for this run. | `animus/src/config.ts`; `lantern-local/src/config.ts` |
| `lives` | map: `strong`, `fast`, `smoke` to life ids | Which life each tier runs. `./geldar.ps1 adam up --model` rewrites `agent.username`, `agent.tier` and `run_tier` from it; the loaders ignore it. | `tools/adam-cli/src/cli.ts` lines 105 to 146 |

## `shards/colo.yaml`

A flat file: `key: value` lines only. `geldar.ps1` refuses unknown keys, a repeated key and any line that is not a pair (`Read-ColoConfig`, `geldar.ps1` lines 73 to 87). Its keys are declared in `contract/schemas/shard-config.schema.json`.

| Key | Required by `geldar.ps1` | Rule in `geldar.ps1` | Rule in the schema |
|---|---|---|---|
| `cpu_limit` | Yes | A number above 0 and at most 64, and at least the sum of the per-service CPU budgets in `compose/colo.yml`. | Required; number, above 0, at most 64. |
| `memory_limit` | Yes | Docker form `^[1-9][0-9]{1,4}[mg]$`; at least Paper's 6 GiB heap plus 1 GiB, and at least the sum of the per-service memory budgets. | Required; same pattern. |
| `minecraft_port` | Yes | Must be exactly 25567; 25565 and 25566 are refused (decision [0082](../decisions/0082-colo-compose-network-and-limits.md)). | Optional; integer 1024 to 65535, not 25566; default 25565. |
| `bind_address` | No | Must be `127.0.0.1` (the default). | Optional; `format: ipv4`; default `127.0.0.1`. |
| `telemetry_url` | Not accepted | Refused as an unknown key. | Optional; `format: uri`. |

The file sets `cpu_limit: 14.6` and `memory_limit: 25088m`, and the per-service budgets in `compose/colo.yml` sum to 14.6 CPUs and 25088m over 13 services (Paper 8 CPUs and 15360m after D1). Re-derive the sums the way `Read-ColoConfig` does (first reference per service):

```powershell
$t = Get-Content -Raw compose/colo.yml; $c=@{}; $m=@{}
foreach ($x in [regex]::Matches($t,'GELDAR_COLO_([A-Z_]+)_(CPUS|MEM):-([0-9.]+)([mg]?)\}')) {
  $s=$x.Groups[1].Value
  if ($x.Groups[2].Value -eq 'CPUS') { if (-not $c[$s]) { $c[$s]=[double]$x.Groups[3].Value } }
  elseif (-not $m[$s]) { $m[$s]=[double]$x.Groups[3].Value } }
"$($c.Count) services; cpu=$(($c.Values|Measure-Object -Sum).Sum); mem=$(($m.Values|Measure-Object -Sum).Sum)m"
```

## `shards/character-fixture.yaml`

| Key | Value shape | Meaning |
|---|---|---|
| `shard` | `character-fixture` | Fixture name. |
| `character.mode` | `sheet` | Character engine on. |
| `character.rolls` | `true` | d20 checks on. |
| `character.proficiency` | `{ enabled, thresholds: [three numbers] }` | Proficiency on, with three thresholds. |
| `sovereign.players[]` | `{ player_id, life_id, name, character_sheet }` | Three fixture Bodies. Each `character_sheet` has `version`, `attributes` (`curiosity`, `common_sense`, `cleverness`, `aggression`), `alignment` (`law`, `good`) and `op_modes` (seven modes), scored 1 to 5 per `contract/schemas/character-sheet.schema.json`. |

The header forbids copying these values into the other shard files (`shards/character-fixture.yaml` lines 1 to 4).

## `envs/environment.schema.json`

One genesis environment, `envs/<name>.yaml` (decision [0188](../decisions/0188-genesis-environment-stamp.md), status Proposed). `additionalProperties: false`. The schema forbids any address other than `127.0.0.1` in a value; the only CIDR is `subnet`, which must be an RFC 5737 documentation `/24`.

| Property | Required | Type and constraint | Meaning (schema `description`) |
|---|---|---|---|
| `name` | Yes | string `^[a-z][a-z0-9-]{1,30}$` | The environment name, also the file name. |
| `project_name` | Yes | string `^[a-z][a-z0-9-]{1,40}$` | The compose project name. |
| `hostnames` | Yes | array of hostname, at least 1 | Public hostnames for the edge. |
| `ports` | Yes | map, at least 1; names `^[a-z][a-z0-9_]{0,30}$`; integers 1 to 65535 | Loopback port names to port numbers. |
| `paths` | Yes | map of name to path (no whitespace, 1 to 300 characters) | Host path names to host paths. |
| `subnet` | Yes | one of the three RFC 5737 `/24` ranges | The compose subnet. |
| `docker_network_name` | Yes | string `^[a-z0-9][a-z0-9_.-]{1,62}$` | none |
| `docker_gid` | Yes | integer 1 to 2147483647 | The host group id of the Docker socket. |
| `register_kill_switch` | Yes | `const: true` | `REGISTER_KILL_SWITCH`, fixed true in every stamp. |
| `backup_destination` | Yes | name `^[a-z][a-z0-9_-]{0,40}$` | The name of a backup destination; never its address or credentials. |
| `image_digests` | No | map of name to `<ref>@sha256:<64 hex>` | Image references pinned by digest. |
| `versions` | No | map of name to version string | none |
| `supervisor_enabled` | No | boolean, default `false` | When `true`, `supervisor_live_check` is required (`allOf` rule). |
| `supervisor_live_check` | When `supervisor_enabled` is `true` | string `^[A-Za-z0-9][A-Za-z0-9._/-]{2,120}$` | The recorded live check that allows `supervisor_enabled: true`. |
| `register_enabled` | No | boolean, default `false` | none |
| `body_nats_secret_host_path` | No | path | Host path of the Body NATS secret; the file is never in the repo. |
| `body_shard_host_path` | No | path | none |
| `register_public_url` | No | `https://` URL | none |
| `mcp_public_host` | No | hostname | none |
| `register_shard` | No | name | none |
| `register_trusted_peers` | No | array of name | none |
| `roster_source` | No | name | none |
| `verification_profile` | No | name | none |

Re-derive the property list and the required list:

```powershell
$s = Get-Content -Raw envs/environment.schema.json | ConvertFrom-Json
$s.properties.PSObject.Properties.Name; $s.required
```

### How `tools/genesis-env` validates

1. `node tools/genesis-env/src/cli.ts` (or `./geldar.ps1 pnpm --filter @geldar/genesis-env validate`) reads every `envs/*.yaml`. It exits 1 when one fails or when no environment file exists (`tools/genesis-env/src/cli.ts` lines 2 to 4, 17 to 21).
2. Each file must parse as one YAML document with no duplicate keys (`tools/genesis-env/src/validate.ts` lines 2 to 4).
3. The leak scan refuses a PEM block, a NATS seed, a service token, a JSON Web Token, a URL with a password, a secret assignment, a long random string, an email address, an IPv6 address and any IPv4 address other than `127.0.0.1`. Keys are scanned too; `subnet` is skipped because the schema checks it. Pinned image digests are stripped before the random-string rule. A finding names the rule, never the value (`tools/genesis-env/src/leak-scan.ts`).
4. The file is validated against the schema with Ajv; errors report the keyword and location only (`tools/genesis-env/src/validate.ts` line 26).
5. The `env-definitions` gate in `pnpm check:repo` runs the same validation and fails when a `envs/*.yaml` exists but the schema is missing or not JSON (`tools/repo-checks/src/env-definitions.ts`).

## Gates on these files

| Gate | What it checks | Evidence |
|---|---|---|
| `Read-ColoConfig` in `./geldar.ps1 check` and `shard up colo` | The `shards/colo.yaml` rules above. | `geldar.ps1` lines 73 to 138, 146 |
| `identity-mode` in `pnpm check:repo` | A shard that allows sovereign players declares `identity_mode: watched` (spec 5.15.8). Reads both the spec's scalar form (`sovereign: allowed`) and the block form. | `tools/repo-checks/src/identity-mode.ts` lines 1 to 6 |
| `env-definitions` in `pnpm check:repo` | Every `envs/*.yaml` validates. | `tools/repo-checks/src/env-definitions.ts` |
| `colo-services.test.ts` | The Colo services mount `shards/colo-mind.yaml` read-only at `/opt/geldar/shards/colo.yaml`. | `tools/repo-checks/src/colo-services.test.ts` lines 72 to 75, 231 to 232 |

## Conflicts recorded

Recorded, not resolved (persona rule 8).

1. **Border radius.** Spec 5.1 sets the baseline border at radius 1500 (`docs/spec.md` line 322). `shards/phase0.yaml` matches. `shards/colo-mind.yaml` line 10 and `compose/colo.yml` lines 137 to 138 set radius 9500 (diameter 19000), with a comment that the owner moved it on 2026-11-15 for a spawn-town cutover. `git grep -lE "9500|19000" -- docs/decisions` finds no decision record for the move on 2026-11-16.
2. **One shard file per shard.** Spec section 6.6 (`docs/spec.md` line 1161) shows `shards/` as "one shard.yaml per shard". The Colo shard has two files: the flat budget file `shards/colo.yaml` and the Mind file `shards/colo-mind.yaml`, mounted under the name `colo.yaml` (decision 0131; `shards/colo-mind.yaml` lines 1 to 5).
3. **`shards/colo.yaml` budget comment.** Its header (lines 4 to 9) says the totals are 10.5 CPUs and 19904m; the file sets 10.6 and 19968m, which equals the measured sum of the 14 per-service budgets. The comment does not count `bluemap-alias` (0.1 CPU, 64m).
4. **`minecraft_port` default.** `contract/schemas/shard-config.schema.json` gives a default of 25565 and rejects only 25566. `geldar.ps1` refuses 25565 and accepts only 25567 (decision 0082).
5. **`telemetry_url`.** The schema declares it; `Read-ColoConfig` refuses it as an unknown key (`geldar.ps1` line 74 lists four known keys).
6. **Schema description.** The shard-config schema says "the Phase 0 shard file has none of these keys yet"; it describes only `shards/colo.yaml`, not the block-shaped files. The [glossary](glossary.md) row "Shard" cites the schema as the shard config; the block-shaped files have no schema.
7. **Genesis schema home.** Decision 0188 point 1 says an environment is "validated by a contract schema". The schema lives in `envs/`, and its own description says the validator is "hand-typed, not generated from contract/". Decision 0188 point 8 names `envs/colo.yaml`; only `envs/test.example.yaml` exists at `1b114276`.
8. **Spec `sovereign` form.** Spec Appendix E writes `sovereign: pure` (scalar, `allowed` or `pure`). Both shard files use a block with `allowed: true`. The `identity-mode` gate accepts both forms.
9. **Unread keys.** `population_target`, `seed`, `chat.shout_enabled` and `lifecycle.permadeath` appear in both files; the search above found no code that reads them as configuration on 2026-11-16. `chat.shout_enabled` also appears in `bench/sheet/scratch-shard.template.yaml` line 10.
