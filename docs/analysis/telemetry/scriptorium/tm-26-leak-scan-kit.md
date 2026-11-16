# TM-26: telemetry vocabulary scan over everything the model can read in the kit (scriptorium repo)

Repo: geldar-scriptorium. Depends on: none. Unblocks: a standing guard for every other card. Mind redeploy: none (test only). `colo-images` path: n/a. Kit-side half of survey card T-19 (the geldar half, `MARKER_WORD` in `contract/src/agent-text.ts`, belongs to another session and is a `colo-images` path).

## Goal

A test that fails if a telemetry word appears in anything the model reads from the kit: the template (`template/**`: `.mcp.json`, `.claude/settings.json`, agents, skills, hooks, CLAUDE-style files), the prompt text the supervisor builds (`prompt.ts` output for sample inputs), the managed settings (`image/settings/*.json`), and file names under those trees. Decision 0350 point 7; 0059 and 0068 (agents must not learn they are watched).

## Files (exactly these)

- `tests/template/telemetry-words.test.ts` (new)

## Steps

1. Read `tests/template/check.ts` and the existing tests in `tests/template/` for how the template tree is located and walked; reuse that helper, do not duplicate it.
2. Word list (case-insensitive, whole-word or as a segment of a file name): `telemetry`, `otel`, `opentelemetry`, `traceparent`, `tracestate`, `trace id`, `trace_id`, `span id`, `span_id`, `signoz`, `clickhouse`, `observability`, `instrumentation`, `monitoring`, `monitored`, `watched`, `being watched`, `logged for`, `we record`, `recorded for`. The list is in one constant at the top of the file.
3. Scan targets: (a) every file under `template/` (text files; skip binary by extension), content and path; (b) `image/settings/*.json`; (c) the prompt: call `buildPrompt` and `buildTidyPrompt` from `packages/supervisor/src/prompt.ts` with a range of sample inputs (empty, long, with a handoff, with a note) and scan the output; (d) the supervisor's `say()` strings reach the operator, not the model: skip them.
4. Allowed exceptions are an explicit list in the test file, each with a one-line reason. Start with an empty list. If the existing template contains a hit, the coder lists it in the report and in the exception list ONLY if it is clearly unrelated (for example the word "monitoring" in a sentence about hunger), and the orchestrator decides; never edit a released template (R10).
5. Tests: (a) the scan passes on today's tree (with exceptions if any); (b) a self-test: scanning a temp copy of the template with the line `OTEL_EXPORTER=1` appended to `.mcp.json` FAILS naming the file and word; (c) a file named `otel-notes.md` in a temp copy fails by path; (d) the prompt scan uses neutral inputs only (a player's own words may legitimately contain any word, so the test never feeds a telemetry word as input): `buildPrompt` and `buildTidyPrompt` outputs are clean, and a self-test that patches the static prompt text with `telemetry` fails.
6. Revert check: add `telemetry` to a skill in a temp copy; (b) must fail. Remove the `.mcp.json` file from the scan list; (b) must fail.

## Checks and commit

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:template`, `pnpm check:repo`, `git diff --check`. Commit: `T-19 TM-26: scan the kit's model-readable files and prompt for telemetry words (tests)` plus the two trailers.

## Do NOT

- Do not edit any file under `template/` or `image/settings/`.
- Do not add a skill, hook or doc that mentions telemetry anywhere the model reads. Operator docs go under `docs/`, which the model never sees (the supervisor's workspace is `/player`, not the repo).
