# Wave 5 Adam regression: diagnosis (R3a)

Verdict: model variation, path-dependent through the recent-thoughts history. No prompt regression found.

- Both prompts are thought@1 with byte-identical system messages (SHA-256 prefix 8DBD8F3D83FEB8C4, 7673 chars).
- User messages have the same 38-line structure and the same section headers in the same order, with no line dropped by the world-text budget (the quoted text keeps its `person` line in both).
- The only structural difference is the recent-thoughts history: good has 17 entries with 13 `intent` lines, bad has 10 entries with 1 `intent` line.
- The bad history is greeting-only: "I should ask if they need help", then "I should respond to ag_chatter_01's message" with `said` and no intent. The model copies its own no-intent pattern.
- The fix round did not touch the history source: `MAX_RECENT_THOUGHTS = 20` in `animus/src/prompts/render-memory.ts` only caps it, and the budget in `world-text.ts` only trims the quoted-text section.
- Other candidates (belief limit, whole-digest line, `bornDay` null, memory-load timeout) do not change any section of these two prompts.
- Raw outputs: good is a `travel` intent with `say`; bad is `reasoning` and `say` only.

Proposal (not implemented): in `golem/test/live/chatter-bot.ts`, keep `ag_chatter_01` silent until Adam's first accepted intent, so the history Adam sees is not a greeting loop. Scope it to the live smoke only.
