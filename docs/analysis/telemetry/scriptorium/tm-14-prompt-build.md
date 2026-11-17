# TM-14: prompt build attributes and prompt text (scriptorium repo)

Repo: geldar-scriptorium. Depends on: TM-13. Unblocks: nothing. Mind redeploy: next kit image (batched). `colo-images` path: n/a.

## Goal

On the `mind.run` span, record how the prompt was built (block sizes, cut flag, hashes) and, under decision 0350 point 2, the prompt text itself, in full, as a content event. Survey M4.

## Files (exactly these)

- `packages/supervisor/src/telemetry/prompt.ts` (new): `recordPrompt(tel, info)`.
- `packages/supervisor/src/supervisor.ts` (edit, 2 to 4 lines inside `oneRun` and `oneTidy`, right after `writePrivate(promptPath, ...)`)
- `packages/supervisor/src/telemetry/run-span.ts` (edit only to expose `span()` returning the open span or `undefined`; 3 lines)
- `packages/supervisor/src/telemetry-prompt.test.ts` (new)

## Steps

1. Read the SC-183 log line in `oneRun` (`prompt run=N goals=... handoff=... words=... identity=... cut=...`) and `prompt.ts` (the supervisor's `buildPrompt`, `buildTidyPrompt`).
2. `recordPrompt(tel, { text, goalsBytes, handoffBytes, wordsChars, identityBytes, cut, kind })`:
   - attributes on the open `mind.run` span (names from TM-01): `prompt.goals_bytes`, `prompt.handoff_bytes`, `prompt.words_chars`, `prompt.identity_bytes`, `prompt.cut` (boolean), `prompt.sha256` (SHA-256 hex of the exact prompt text), `prompt.template_version` (the version string the kit's prompt template carries, if `prompt.ts` exposes one; otherwise the SHA-256 of the static template text with the variable parts removed, documented in a code comment; UNVERIFIED which exists, the coder reads `prompt.ts` and reports the choice).
   - the full prompt text with `addContentEvent(span, 'prompt', text)` (event `geldar.content.prompt`).
3. In `oneRun` and `oneTidy`, call `recordPrompt(...)` with values the code already has in scope. The byte and char counts are the same numbers the SC-183 log line already computes: reuse the locals, do not recompute.
4. The call is wrapped like every emit (swallow and count). With telemetry off the function returns before hashing or reading anything.
5. Tests:
   - (a) the span carries the six numeric/boolean attributes equal to the numbers in the `supervisor.log` `prompt run=` line for the same run (parse the line, compare).
   - (b) `prompt.sha256` equals `sha256(contents of prompt.txt)`; the content event text equals the prompt when it is under 32 KiB, and is capped with `.truncated=true` and `.bytes` equal to the true size when it is larger (construct a large `goals` block).
   - (c) the prompt written to `prompt.txt` and passed to the child is byte-identical with telemetry on and off.
   - (d) the content never appears as an attribute without the `geldar.content.` prefix, and never in a metric (scan the in-memory metric data for a distinctive word of the prompt).
   - (e) dead exporter: same as TM-13 (d).
6. Revert check: remove the `recordPrompt` call in `oneRun`; (a) must fail. Replace `addContentEvent` with `span.setAttribute('prompt', text)`; (d) must fail (the allow-list drops it and the event is absent).

## Checks and commit

Same checks as TM-13. Commit: `T-13 TM-14: prompt build attributes and prompt text on mind.run (supervisor)` plus the two trailers.

## Do NOT

- Do not write the prompt anywhere new on disk. `prompt.txt` (0600) stays as is.
- Do not log the prompt text through `supervisor.log` or stderr.
- Do not edit `prompt.ts` or any released template.
