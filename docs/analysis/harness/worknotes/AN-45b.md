# AN-45b worknote: body-api v13 with explore, farm and patrol, unselected

- Built `prompts/body-api/v13.json` from v12 (copy, then version, description and three program entries). Summaries are the owner-approved text of 2026-11-27, verbatim. Arguments and bounds follow decision 0344 and `PROGRAM_ARGS` (AN-45a).
- v1 to v10 and v12 untouched; no v11 file; no `contract/**` change; no default selection in this repo.
- `golem/src/mind-link/body-api-released.test.ts` pins the sha256 of the eleven released files and asserts no `v11.json`.
- `golem/src/mind-link/body-api-v13.test.ts` checks the v13 examples as thoughts, that they start on the Body, that their arguments pass the program validators, the verbatim summaries, and that no marker word appears in the file.
- `follow` refuses a target it cannot see, so its example runs with that person in sight (the v2 test never covered `follow`).
