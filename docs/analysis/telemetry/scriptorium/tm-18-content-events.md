# TM-18: content events: assistant text, reasoning, tool arguments and results, journal writes (scriptorium repo)

Repo: geldar-scriptorium. Depends on: TM-17. Unblocks: nothing. Mind redeploy: next kit image (batched). `colo-images` path: n/a.

## Goal

Capture, in full and with no opt-out (decision 0350 point 2), the text the Mind produced and received, as span events on the spans TM-17 creates: the assistant's text (the thought), its reasoning, each tool call's arguments and result, and journal writes. Same helpers and the same conventions as the MCP's T-06c (`geldar.content.<name>` events with `.bytes` and `.truncated`, 32 KiB cap).

## Files (exactly these)

- `packages/supervisor/src/telemetry/stream-content.ts` (new): `contentFor(record)` returns the list of `{ name, text }` to attach.
- `packages/supervisor/src/telemetry/stream-spans.ts` (edit, small: after creating a span, call `attachContent(span, contentFor(record))`)
- `packages/supervisor/src/telemetry-stream-content.test.ts` (new)

## Event names (match the MCP's: `tool_arguments`, `tool_result`)

| Where | Event `geldar.content.<name>` | Text |
|---|---|---|
| `chat` span | `assistant_text` | the turn's text blocks joined |
| `chat` span | `reasoning` | the turn's thinking blocks joined (only when non-empty; the ChatGPT harness has none) |
| `execute_tool` span | `tool_arguments` | `JSON.stringify(input)` with secret-named keys replaced by `[redacted]` (reuse the same rule as the MCP's `redactArguments`: any key for which `hasForbiddenSegment(key)` is true) |
| `execute_tool` span | `tool_result` | the `tool_result` content string (image bytes already replaced by the parser) |
| `execute_tool` span, tool `journal` | `journal_entry` | the journal text argument, in addition to `tool_arguments` (a typed copy so a query by event name finds journals; if the argument field name is not known, the whole arguments JSON; the coder reads `template/.mcp.json` and the MCP's journal tool schema in `contract/` to name the field, and says which) |

Thoughts on the Mind side are the assistant text. World-side thought records (`thought_id`) are the MCP's and the Body's cards, not this one.

## Steps

1. Read `threshold/mcp/src/telemetry.ts` in the geldar repository (path in the brief) for `redactArguments` and `addContentEvent` usage; the kit's copy of `addContentEvent` is `@geldar/scriptorium-telemetry`.
2. Write `contentFor`: pure; no SDK import. Redaction is applied to `tool_arguments` only (results are not redacted: no current tool returns a credential; if the brief says otherwise, add result redaction and say so).
3. In `stream-spans.ts`, after each span is created (or ended, for results that arrive later), attach events with `addContentEvent`. Events are added before `span.end()`.
4. Tests:
   - (a) assistant text under 32 KiB: event present, text equal, `.truncated=false`, `.bytes` equal to the UTF-8 length. Over 32 KiB: event text length is the cap, `.truncated=true`, `.bytes` is the original size.
   - (b) reasoning present only when the fixture has a thinking block.
   - (c) arguments with `{ "api_key": "x", "message": "hi" }` become a redacted `api_key` and an intact `message`; a canary secret value never appears in any event.
   - (d) the `journal` tool call yields `journal_entry` with the text.
   - (e) a canary word in every content field is NOT present in any span attribute, metric attribute, log attribute or resource attribute (scan all exported data except the event attributes under `geldar.content.`).
   - (f) the session file, `prompt.txt`, `status.json` and `supervisor.log` are byte-identical with telemetry on and off; a throwing exporter changes nothing.
5. Revert check: delete the `assistant_text` attach; (a) must fail. Skip redaction; (c) must fail.

## Checks and commit

Same as TM-13. Commit: `T-13 TM-18: content events for assistant text, reasoning, tool arguments and results (supervisor)` plus the two trailers.

## Do NOT

- Do not capture to a metric, a log attribute or a span attribute: events only.
- Do not skip content for any player, kind of run or harness (no opt-out in development).
- Do not read the model's memory files or the journal file on disk; only the stream.
- Do not write any capture to a file.
