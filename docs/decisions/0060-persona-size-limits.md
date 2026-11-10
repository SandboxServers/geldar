# 0060. Persona files are not artificially size-limited

- Status: Accepted (owner, 2026-11-09); the fit check below is OPEN until the Wave M `player add --seed-file` packet and the verification in Scope are done
- Date: 2026-11-09
- Spec: 5.15 (sovereign players and their persona), 5.3.3 (the thought prompt and its budget); decisions 0051, 0058

## Scope

The rangers (the sovereign players, spec 5.15) are Claude Code sessions run by the Scriptorium launcher over MCP. Their persona files are read by the launcher and are not rendered into Adam's Ollama thought prompt. So the 600-character single-line `checkIdentity` limit and the `num_ctx` fit analysis in this record apply ONLY to Adam's animus Mind prompt. The fit analysis matters for a sovereign player only if that player's `agents.personality_seed` were ever rendered by the animus Mind.

That is an open verification. Before it is closed, grep `animus` and the Wave M packets for any path that reads `agents.personality_seed` for a sovereign player. The Wave M `player add --seed-file` validation is 8192 bytes for the identity and 4096 bytes for goals, and it must NOT call `checkIdentity`.

## Context

The owner ruled: "use the less restrictive limits on persona files, we don't want to artificially limit effectiveness of agent players." Sovereign players (5.15) bring their own persona, and the Scriptorium launcher takes it through `new --persona-dir`. That launcher limits identity to 8192 bytes and goals to 4096 bytes.

Today the Geldar side is tighter than that for Adam. `checkIdentity` in `animus/src/prompts/library.ts` allows a personality seed of at most 600 characters, one line, and checks only the name and the seed. `prompts/thought/v2.md` puts `{{personality_seed}}` in block 3, and `library.ts` builds the system message from blocks 1 to 4. Goals (`{{goal_stack}}`) are in block 5, which is part of the user message, so the prompt budget governs them.

## Decision

1. Geldar's persona limits for `player add --seed-file` are up to **8192 bytes** for the identity and **4096 bytes** for goals, the same limits as the launcher. Neither is cut short to make a prompt fit; the owner's ruling is that a persona's size is not a Geldar limit.
2. There is no database or schema cap. The identity and goals are plain text in the `agents` row and the config string, and that stays.
3. For Adam's Mind prompt, the practical bound is the thought prompt budget, not a size limit. Stated as a constraint, not a cap: the budget decides what fits, and the fit has to be checked against the pinned `num_ctx`. See Scope for why this does not apply to sovereign players' personas unless they are rendered by the Mind.

## Why

- The owner ruled it, and an artificial limit on a sovereign player's persona makes that player weaker for no safety gain. For Adam's Mind, the persona is still plain single-line text in the system message, so the injection rules in `checkIdentity` (no control characters, no line breaks) stay.
- The launcher and Geldar must agree, or a persona the launcher accepts would fail to load.
- The fit has been measured for Adam's 600-character seed only. The budget numbers come from `library.ts`: `CONTEXT_TOKENS` 8192, `OUTPUT_RESERVE_TOKENS` 2048, and the thought system message measured at 3354 estimated tokens (one token per three ASCII characters). The system and user messages together get 8192 - 2048 = 6144 tokens.
- A maximal identity (8192 bytes) rendered in Adam's Mind is about 2730 estimated tokens. Less the roughly 90 tokens the current seed uses, it adds about 2640 to the system message, which becomes about 6000 tokens. The user message (`mind.prompt_budget_tokens`, default 2500, floor 1000) then cannot fit inside 6144 tokens: 6000 + 1000 is already above it. So a maximal persona in the Mind does **not** fit the 8192 `num_ctx` with the current budget defaults. The numbers are estimates and the test below is the check.

## Consequences

- **Code is not changed by this record.** The 600-character check in `checkIdentity` is still in force for Adam's Mind prompt. The Wave M `player add --seed-file` validation is a separate check (8192 bytes for the identity, 4096 for goals) and does not replace or call `checkIdentity`.
- **OPEN, verification:** confirm that no path renders a sovereign player's `agents.personality_seed` into the animus Mind prompt (grep `animus` and the Wave M packets). If none does, the fit analysis does not apply to rangers and the fit test is not needed for them.
- **OPEN, only if the verification finds a rendered sovereign persona:** the prompt library's fit test (the `fits the default budgets` case in `library.test.ts`) must be re-run with a maximal persona. If the maximal persona does not fit `num_ctx` 8192 with a 2048 output reserve, the options are (a) a larger `num_ctx` for that prompt (a VRAM question for the owner) or (b) a persona cap. Either is an owner decision and gets its own record; neither is taken silently.
- Adam's shard seed (about 265 characters) is unaffected.
