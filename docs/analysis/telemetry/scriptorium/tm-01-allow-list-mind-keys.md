# TM-01: allow-list keys for Mind spans and logs (geldar repo)

Repo: geldar. Depends on: none. Unblocks: TM-10 (kit copy), every kit emit card. `colo-images` path: NO (`telemetry/**` is not in the filter). Merge any time.

## Goal

`telemetry/src/attributes.ts` drops every attribute not on its allow-list. The Mind side needs more names (GenAI cache tokens, run and prompt fields) on the trace and log scopes. Add them, with a test, before the kit copies the file (TM-10).

## Files (exactly these)

- `telemetry/src/attributes.ts` (edit: add keys to `TRACE_LOG_KEYS`; add metric keys only if listed below)
- `telemetry/test/mind-keys.test.ts` (new)

## Steps

1. Read `telemetry/src/attributes.ts` and `telemetry/test/attribute-scopes.test.ts` once.
2. Add these names to `TRACE_LOG_KEYS` (names are compared after a leading `geldar.` is removed, so the span attribute `geldar.run_number` and the OTel-standard `gen_ai.*` names both work):
   - OpenTelemetry GenAI: `gen_ai.provider.name`, `gen_ai.conversation.id`, `gen_ai.agent.name`, `gen_ai.response.finish_reasons`, `gen_ai.tool.call.id`, `gen_ai.usage.cache_read.input_tokens`, `gen_ai.usage.cache_creation.input_tokens`.
   - Mind run: `harness`, `run_number`, `run_kind`, `exit_code`, `turns`, `cost_usd`, `duration_s`, `fails`, `limit_kind`, `timing`, `turn_index`.
   - Prompt build: `prompt.sha256`, `prompt.template_version`, `prompt.goals_bytes`, `prompt.handoff_bytes`, `prompt.words_chars`, `prompt.identity_bytes`, `prompt.cut`.
   Do not add any name containing `token` as a whole word, `secret`, `authorization`, `cookie`, `email`, `password`, `credential` (the package drops those on purpose). `gen_ai.usage.*_tokens` is fine: `tokens` is not the word `token`.
3. Do not touch `METRIC_KEYS` (the Mind metrics use only `harness`, `result`, `state`, `kind`, `direction`, all present).
4. Do not touch `IDENTITY_KEYS`: `player_id`, `life_id` stay refused on metrics.
5. Write `telemetry/test/mind-keys.test.ts`:
   - (a) every new trace name passes `filterAttributes({..}, 'trace')` and `'log'` with `dropped` empty.
   - (b) none of the new names is accepted in the `'metric'` scope (each is dropped `unknown`).
   - (c) `filterAttributes({ 'gen_ai.usage.output_tokens': 5, 'geldar.mind_auth_token': 'x' }, 'trace')` keeps the first and drops the second as `forbidden`.
   - (d) a `geldar.content.assistant_text` string over 32 KiB is capped and carries `.bytes` and `.truncated` (guards that adding keys did not weaken the cap).
6. Revert check: remove the `gen_ai.usage.cache_read.input_tokens` line; test (a) must fail naming that key. Restore.

## Checks

```powershell
./geldar.ps1 pnpm --filter @geldar/telemetry test
./geldar.ps1 pnpm --filter @geldar/telemetry typecheck
./geldar.ps1 pnpm check:repo
git diff --check
```

## Commit

`T-13 TM-01: allow-list keys for Mind spans and logs (telemetry)` plus the two trailers in the brief.

## Do NOT

- Do not add a key that could carry an owner identity, a token or a hostname.
- Do not edit `telemetry/src/index.ts`, `sdk.ts` or any file outside the two listed.
- Do not bump `telemetry/package.json`.
- Note for the report: TM-10 copies this file into the scriptorium repo; record the commit sha of this change, TM-10 pins it.
