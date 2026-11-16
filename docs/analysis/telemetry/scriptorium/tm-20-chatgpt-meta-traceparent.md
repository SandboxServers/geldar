# TM-20: ChatGPT harness sends `_meta.traceparent` on every MCP call (scriptorium repo)

Repo: geldar-scriptorium. Depends on: TM-02 (the MCP reads `_meta` first), TM-13 (a run context to propagate). Unblocks: per-call pairing for the ChatGPT harness. Mind redeploy: next kit image (batched). `colo-images` path: n/a (the geldar-side consumer is TM-02).

## Goal

In the ChatGPT harness the kit's own code is the MCP client (`packages/chatgpt/src/tools.ts`), so it can attach W3C trace context to each `tools/call` as `params._meta.traceparent` (MCP SEP-414; survey 3.2) with no model-visible artefact. The context comes from the supervisor's `mind.run` span through the one environment variable TM-22 defines for the child (`TRACEPARENT`); this card reads that variable inside the harness process. If it is absent, nothing changes.

## Files (exactly these)

- `packages/chatgpt/src/trace-meta.ts` (new): `traceMeta(env)` returning `{ traceparent, tracestate? } | undefined`.
- `packages/chatgpt/src/tools.ts` (edit: where `callTool` is invoked, merge `_meta` into the request params; few lines)
- `packages/chatgpt/src/trace-meta.test.ts` (new)
- `packages/chatgpt/src/tools-meta.test.ts` (new)

## Steps

1. Read `packages/chatgpt/src/tools.ts` (the MCP client wrapper and the `callTool` call) and `cli.ts` (how the process environment reaches it).
2. `traceMeta(env)`: reads `env.TRACEPARENT` and `env.TRACESTATE` once at start. Valid only if it matches `^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$` and the ids are not all zero; otherwise `undefined`. `tracestate` is passed only if it is at most 512 bytes of printable ASCII.
3. Delete `TRACEPARENT` and `TRACESTATE` from the harness process's own `process.env` right after reading them (so nothing the harness spawns, and no debug dump, can show them).
4. In `tools.ts`, pass `{ name, arguments, _meta: { ...existingMeta, traceparent, tracestate } }` to the SDK call only when `traceMeta` returned a value. Keep any existing `_meta` (progress token) intact.
5. Tests:
   - (a) with a valid `TRACEPARENT`, a fake MCP server receives `_meta.traceparent` equal to it on every call of a three-call session.
   - (b) with none, or a malformed one (wrong length, uppercase, zero ids), `_meta` is exactly what it was before (deep-equal to the pre-change request).
   - (c) after start, `process.env.TRACEPARENT` is undefined.
   - (d) the tool result handed to the model is unchanged by the presence of trace context (compare with and without).
   - (e) the harness's stdout stream lines contain no trace id (scan).
6. Revert check: stop deleting the variable; (c) must fail. Drop the merge; (a) must fail.

## Checks and commit

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:repo`, `git diff --check`. Commit: `T-14 TM-20: ChatGPT harness attaches _meta.traceparent to MCP calls (chatgpt)` plus the two trailers.

## Do NOT

- Do not write the trace id to any file, argument, prompt or stdout line.
- Do not propagate `tracestate` beyond what step 2 allows; never Baggage.
- Do not switch the variable on in production before TM-22 and the isolation tests (TM-24, TM-25) are merged.
