# TM-16: pure session stream parser, shared with HC-41a (scriptorium repo)

Repo: geldar-scriptorium. Depends on: none. Unblocks: TM-17, TM-18, TM-19, and HC-41a (`turns.jsonl`). Mind redeploy: none by itself (library). `colo-images` path: n/a.

## Goal

One parser turns the lines of `session-<n>.jsonl` (stream-json from the Claude CLI, or the ChatGPT harness's equivalent) into a neutral list of records. No telemetry, no I/O beyond what the caller feeds it, no clock. Telemetry (TM-17, TM-18) and the future `turns.jsonl` (HC-41a) both build on it, so the two cannot disagree (survey M2, 4.6).

## Files (exactly these)

- `packages/verify/src/session-stream.ts` (new)
- `packages/verify/src/session-stream.test.ts` (new)
- `packages/verify/src/index.ts` (add the export; read it first, it may be a different filename)
- `packages/verify/src/fixtures/session-*.jsonl` (new, small, synthetic; at most 4 files; no real transcripts, no real player text)

## Types (exported)

```ts
export interface StreamUsage { input: number; output: number; cacheRead: number; cacheCreation: number }
export type StreamRecord =
  | { kind: 'init'; model: string | null }
  | { kind: 'turn'; index: number; id: string | null; model: string | null; usage: StreamUsage | null; stopReason: string | null; parentToolUseId: string | null; text: string; reasoning: string; toolUses: Array<{ id: string; name: string; input: unknown }> }
  | { kind: 'tool_result'; toolUseId: string; isError: boolean; content: string; parentToolUseId: string | null }
  | { kind: 'rate_limit'; status: string; limitKind: string | null; resetsAt: number | null }
  | { kind: 'result'; isError: boolean; turns: number; costUsd: number; usage: StreamUsage | null; subtype: string | null };
```

## Steps

1. Read `packages/verify/src/run-summary.ts` (the existing builder; do not change it) and `packages/stub-cli/src` (the scenarios produce the stream shapes the tests use). Read `packages/supervisor/src/supervisor.ts` `findUsageLimit` (about lines 126 to 154) for the `rate_limit_event` shape.
2. `parseSessionLine(line: string, state: ParserState): StreamRecord[]` and `class SessionParser { feed(line): StreamRecord[]; }` with a `turnIndex` counter. Rules:
   - A blank line or one that is not a JSON object yields `[]` (never throws).
   - `type: 'system'` with `subtype: 'init'` yields `init` with `model`.
   - `type: 'assistant'` with `message.content[]`: concatenate `text` blocks into `text`; concatenate `thinking` blocks into `reasoning`; collect `tool_use` blocks as `toolUses` (`id`, `name`, `input` kept as parsed JSON). `usage` from `message.usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, each default 0). `parentToolUseId` from the line's `parent_tool_use_id` (null when absent: a subagent line carries its parent's tool-use id).
   - `type: 'user'` with `tool_result` blocks: one `tool_result` record per block, `content` flattened to a string (string content as is; an array of `{type:'text',text}` joined by newline; an image block replaced by `[image <n> base64 chars]`, never the bytes).
   - `type: 'rate_limit_event'` yields `rate_limit` (reuse the same field names `findUsageLimit` reads).
   - `type: 'result'` yields `result` (`total_cost_usd`, `num_turns`, `is_error`, `usage`, `subtype`).
   - Unknown `type` yields `[]`. Unknown block types inside content are skipped.
3. Memory: the parser keeps only the counter. A line is parsed and dropped; text is not retained between calls.
4. Fixtures: write four small synthetic streams: (1) one turn, one tool call and result, a result line; (2) a subagent turn with `parent_tool_use_id`; (3) a rate-limit rejected run; (4) a line with an image tool result and a thinking block. If `packages/stub-cli` can generate them, generate and check in the output; note in the report any field in the real CLI's shape that the survey described and the stub does not produce (README A3).
5. Tests: (a) each fixture parses to the exact expected records (deep equality); (b) fed in arbitrary chunk splits through a line splitter, the result is the same; (c) malformed JSON, a JSON array, and a 5 MB line do not throw and yield no records for the bad lines; (d) the image result contains no base64 body (assert the string length is small); (e) `RunSummaryBuilder` and `SessionParser` agree on turns, cost and tool counts for fixture 1 (guards drift from the existing summary); (f) the parsed `turn.text` equals the existing `last_text` source before the 1,500-character cut.
6. Revert check: make the parser skip `thinking` blocks; fixture 4's test must fail. Make it ignore `parent_tool_use_id`; fixture 2's test must fail.

## Checks and commit

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:repo`, `git diff --check`. Commit: `T-13 TM-16: pure session stream parser shared by telemetry and turn records (verify)` plus the two trailers.

## Do NOT

- Do not change `run-summary.ts` or its tests.
- Do not read files, spawn processes or call the clock in the parser.
- Do not add telemetry imports to `packages/verify`.
- Do not check in a real session transcript.
