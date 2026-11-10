# Wave 5: first-try validity of qwen3:8b (R4a, 2026-11-09)
Probe: prompt "You hold a white_bed. Place it near you. Answer with the JSON object only.", think off, num_ctx 8192, temperature 0.7, 10 calls per condition, each output checked by `createOutputValidator().parseThought`.
Before: the decode schema's `actions.items` was one object with a `do` enum and optional fields, so the grammar allowed any field on any verb. First-try valid 0/10 (rejections: `target` required, `item` and `at` not allowed, `do` constant).
After: `actions.items` is a `oneOf` with one variant per verb (`do` const, that verb's fields required, `additionalProperties: false`), from `ACTION_FIELDS`. First-try valid 10/10, and Ollama accepted the schema without error.
Without the schema as `format`: not measured, the 20-call budget went to the two schema conditions.
Rate: before 0/10, after 10/10 (rates are per 10 calls, so the interval is wide).
Keywords dropped from the decode schema: none; `oneOf`, `const`, `anyOf`, `additionalProperties`, `minimum`, `maximum` and `maxLength` are kept. Whether the engine enforces the numeric bounds is not verified; the strict validator stays the gate.
The contract's `place` variant requires `block` and `at` (not `target`); the decode schema follows the contract.
The corrective message now reports only the named verb's missing and extra fields, plus one line of valid verbs, when the first error is in `/actions/N`.
The loop, the released templates and the contract schema are unchanged.
