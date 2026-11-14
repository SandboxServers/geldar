# 0181: the context window is raised from 8192 to 8704 so the till thought prompt fits

- Status: Accepted (owner ruling, 2026-11-13: "Raise the budget")
- Date: 2026-11-13
- Amends: the `num_ctx` value 8192 in decision 0051 and the `CONTEXT_TOKENS` constant in `animus/src/prompts/library.ts`. Decision 0060 gives the 8192 fit arithmetic; read its numbers against the 8704 window here.

## Context

The `till` action (decision 0167) adds its wording to body-api v7 and its schema to the thought system message. With both in place, the two budget guards in `animus/src/prompts/library.test.ts` failed at 8192: the default-budget guard measured 8296 and the thought v4 guard 8275, against a limit of 8192. The thought budget itself (`mind.prompt_budget_tokens`, 2500) and the output reserve (2048) were not the cause; the system message grew to 3748 estimated tokens. The estimate charges one token per three ASCII characters, as before.

## Decision

Owner ruling, 2026-11-13: raise the budget rather than trim the agent guidance.

1. `CONTEXT_TOKENS` goes from 8192 to 8704 (+512, +6.25 percent), the smallest step that fits the default thought prompt with a margin. The sum is 2500 + 3748 + 2048 = 8296, a margin of 408.
2. `num_ctx` goes from 8192 to 8704 for both pinned models, `qwen3:32b` and `qwen3:8b`, in `shards/phase0.yaml` and `shards/colo-mind.yaml`. The Ollama option has to match the constant, or Ollama truncates the prompt.
3. Unchanged: `prompt_budget_tokens` 2500, the output reserve 2048, the reflection budget 4000 (6821 with its system message, which fits 8704), the model digests, and the body-api and thought templates.

A test in `animus/src/config.test.ts` checks that both pins' `num_ctx` equal `CONTEXT_TOKENS`, so the two cannot drift apart.

## Cost

- Extra context per thought: the thought system message is 394 estimated tokens larger than the 3354 that decision 0051 and the phase0 comment quote for thought v2. Each of the seven agents' thoughts pays that extra prefill on the 8B model (`qwen3:8b`), and on the 32B model when it is used.
- Ollama memory: the KV cache grows with `num_ctx`. The arithmetic is 8704 / 8192, about 6 percent more KV cache per loaded model, on the 24 GB card that also holds the other pinned model and the embedding model on the CPU. **VRAM and latency at 8704 were not measured.** Measure them on the card before a live run that depends on the headroom.
- Model reload: a changed `num_ctx` is a changed Ollama option. The next job on each model after this change loads a runner with the new window, which is a model reload, not a restart of the process. The `modelConfig` string recorded with each job changes from `num_ctx=8192` to `num_ctx=8704`.

## Scope

- No change to `docs/spec.md`: the spec does not state a context window or a token budget.
- No change to the released templates, the thought budget, or the output caps.
- The 0060 record's numbers (the maximal persona and the 6144 tokens for system plus user) are arithmetic on 8192; they are not revised here, and this record gives the new window for them.

## Consequences

- The guards in `library.test.ts` now check the prompt against 8704. A prompt over 8704 fails them, and the revert check for this record restores 8192 and watches the guards fail.
- If a later template or persona needs more room, the next step is a new owner ruling, not a silent change to `num_ctx`.
