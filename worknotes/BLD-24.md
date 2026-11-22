# BLD-24 worknote

- `prompts/body-api/v12.json`: v10 plus the `break` verb (dig the one block at a position) and the `plan` verb (add, replace or cancel a plan of block cells). Its verb list equals `PHASE0_VERBS`; its programs are the same as v10. Each example is accepted by the output validator.
- The wording teaches what the verbs do and refuse; no line suggests building, sets a goal, or names an observer, watcher, recorder, stream or credit (decision 0425). The default stays `body-api/v10.json` (`DEFAULT_BODY_API_VERSION` unchanged).
- `prompts/README.md`: one row for v12.
- Tests in `animus/src/prompts/library.test.ts`: the v12 verb and program list, the examples through the validator, the load as `body-api@12`, and a text scan for building suggestions and observer words.
- v11 is not in the repo (AN-45b has not merged), so v12 is the next number, as the packet allows.
