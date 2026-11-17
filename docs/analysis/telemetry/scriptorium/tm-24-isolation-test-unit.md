# TM-24: isolation test (HC-26 extension), unit level: the model child inherits nothing of the supervisor's environment (scriptorium repo)

Repo: geldar-scriptorium. Depends on: none. WRITE THIS FIRST: it must exist before any card changes `childEnv`, so no later card can weaken it. Unblocks: TM-25. Mind redeploy: none (test only). `colo-images` path: n/a.

## What it proves

The supervisor builds the model child's environment explicitly (`childEnv`, `supervisor.ts:74-94`) from an allow-list (`PASS_THROUGH`). The ingest token and the telemetry settings live elsewhere (the otel-agent holds the token; the supervisor holds only `GELDAR_TELEMETRY_URL`), but the test must hold even if a future change puts the token into the supervisor's environment (README A1). The test therefore plants canaries in the supervisor's environment and proves none reaches any child the supervisor starts.

## Files (exactly these)

- `packages/supervisor/src/child-env-isolation.test.ts` (new)

## Canaries (placed in the supervisor's environment passed to `makeFixture` / `childEnv`)

| Name | Why |
|---|---|
| `GELDAR_INGEST_TOKEN` = `canary-ingest-token-7f3a` | the token, if it ever lands here |
| `OTEL_EXPORTER_OTLP_HEADERS` = `Authorization=Bearer canary-ingest-token-7f3a` | the usual way to hold it |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES` | telemetry vocabulary |
| `GELDAR_TELEMETRY_URL`, `GELDAR_PLAYER_ID` | the kit's own telemetry settings |
| `TRACEPARENT`, `TRACESTATE` | a foreign trace context |
| `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA`, `OTEL_LOG_USER_PROMPTS` | CLI native telemetry switches |
| `GH_TOKEN`, `OPENAI_API_KEY`, `AWS_SECRET_ACCESS_KEY` | ambient secrets (existing rule, kept) |

## Steps

1. Read `packages/supervisor/src/chatgpt.test.ts` (the existing sentinel test for provider credentials), `fixture.ts` and the exec call sites in `supervisor.ts`: `asPlayer` (used by `oneRun` through `childEnv(settings, this.env)`), `oneTidy` (`childEnv(s, this.env, s.tidyMaxTurns)`), the save step (`{ ...childEnv(...), ...GIT_ENV, ...env }`), and the upstream sync's own environment (`upstream.ts`, `GIT_ENV`).
2. The test runs the supervisor through the fixture with the canary environment and captures EVERY `ExecSpec` passed to `deps.exec` for a play run, a tidy run (force `tidyDue`), the save step and the upstream sync. For each captured spec:
   - (a) no value contains `canary` (serialize the env object and search), and no key matches `/otel|telemetry|ingest|trace|monitor|tracestate/i`, except the explicit allow-set below.
   - (b) the key set is a subset of `ALLOWED` = the names `childEnv` produces today (`HOME`, `CLAUDE_CONFIG_DIR`, `GELDAR_MODE`, `PATH`, `GELDAR_RUN_MAX_TURNS`, `GELDAR_RUN_MODEL`, `NODE_USE_ENV_PROXY`, and the `PASS_THROUGH` names that were set) plus, for the git-calling specs, the `GIT_ENV` names. Snapshot this list in the test file; adding any name requires editing the list, which a reviewer sees.
   - (c) `GELDAR_MCP_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN` ARE passed (the model needs them); the test says so, so nobody "fixes" it into the token canary's category by accident.
3. Direct `childEnv` tests for both harnesses (`claude`, `chatgpt`) with the same canaries: same assertions.
4. A "who sees what" assertion: `supervisor.log`, `status.json`, `costs.csv`, `prompt.txt` written during the run contain no canary (the supervisor must not echo its own environment).
5. Revert check (do all three, one at a time, and restore): (i) add `'GELDAR_INGEST_TOKEN'` to `PASS_THROUGH`: (a) fails naming the canary; (ii) add `...env` (spread the whole supervisor environment) to `childEnv`: (a) and (b) fail; (iii) put `console.log(env)`-style echo into `log()`: (4) fails. State the three results in the report.
6. `ALLOWED` never gains `TRACEPARENT`, `TRACESTATE` or any `OTEL_*` name: the child gets no telemetry context (R3, 0350 point 7; the former TM-22 that would have added it is dropped). Any edit that adds one is a failure of this test, not a reason to edit the list.

## Expected result

Passes on today's code with zero changes to `supervisor.ts`. It must fail for each of the three mutations in step 5.

## Checks and commit

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:repo`, `git diff --check`. Commit: `T-14 TM-24: HC-26 extension, unit test that the model child inherits none of the supervisor's environment (supervisor)` plus the two trailers.

## Do NOT

- Do not edit `supervisor.ts` or `PASS_THROUGH` in this card.
- Do not use real tokens, even in a test; the canaries are fake strings.
- Do not delete or loosen the existing sentinel test in `chatgpt.test.ts`.
