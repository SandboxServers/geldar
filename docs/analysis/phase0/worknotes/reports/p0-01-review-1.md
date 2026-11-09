# P0-01 review 1

Verdict: fix

Commit 8f17621 trailers, verbatim:

```
Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015Wz3WivzkDVS6r65y6RFEk
```

The brief required `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. The coder wrote Haiku 5.5 and justified it in its report; that overrides the brief, so it counts as spec drift. The Claude-Session line is correct.

Runs (my own, in the worktree):
- `./geldar.ps1 pnpm --filter @geldar/contract check:generated` exit 0, "up to date".
- `./geldar.ps1 pnpm test` exit 0, 3 files, 13 tests.
- Cross-package import: I put a junction `node_modules/@geldar/contract` -> `contract/` in a scratch dir outside the repo and ran `import { validateSnapshot } from '@geldar/contract'` under Node 22.23.2. It loads, validates, and returns errors. The "Watch for" item holds with no build step.
- I did not rerun the mutation checks. Read-only, and they would need edits.

## Fix notes

1. `contract/src/index.ts:19-21` (`formatError`): the "name already in message" test is a substring check, so it skips the suffix whenever the property name happens to be a substring of Ajv's message. I ran `validateSnapshot({a:1,e:2})` and got two errors, both `"" must NOT have additional properties`, with neither `a` nor `e` named. "must NOT have additional properties" contains `a`, `e`, `o`, `p`, `s`, `t`, `r`, `n` and `pro`; "must have required property 'x'" has the same hole for a short name. An unknown property named `a` would reach the Mind as an unnamed error, which breaks the packet requirement that the formatter append the name. Fix: for `additionalProperty` always append ` '<name>'`; for `missingProperty` test `message.includes(`'${name}'`)` with the quotes, or always append only when absent. Add a test with a short extra property (for example `value.a = 1`, expecting a string that includes `'a'`). The current `foo` test passes by luck, because "foo" is not in the message.
2. The trailer (above): reword the commit so the `Co-Authored-By` line reads `Claude Sonnet 5.5 <noreply@anthropic.com>` as the brief required. This needs an amend or reword. The orchestrator should decide how to do it, since dispatch rule 8 says commit once.
3. `contract/test/snapshot.test.ts`: the "missing agent_id" test would pass with no formatter at all, because Ajv's required message already contains `'agent_id'`. It is not wrong, but it guards nothing about the formatter. Item 1's new test covers the formatter. Also add one test for the explicit packet addition: a snapshot without `revision` fails and names `revision`. Today nothing guards `revision` being required. Reverting it from `required` would leave all 13 tests green.
4. `contract/src/index.ts:11`: `ValidationResult` has only a trailing line comment. Repo rules want a doc comment on public items. Make it a `/** ... */`.

## Non-blocking notes (no action needed for this packet)

- Deviation 1 (`createRequire` prelude): justified. The only `require` in the output is `ajv/dist/runtime/ucs2length`, which Ajv emits for `minLength`/`maxLength`. Alternative: Ajv option `unicode: false` removes it, but it counts UTF-16 units rather than code points, so the packet's "chars" would change meaning. Keep the prelude. If Glass ever bundles this for a browser, `node:module` will break; revisit then.
- Deviation 2 (`.default` on CJS imports): justified. It runs under Node and vitest.
- Deviation 3, 4 (`book_id` plain 1-64 string): fine. Spec 7 and Appendix D (`book_id TEXT`) define no prefix. The `maxLength: 64` is invented and harmless.
- Deviation 5, 6 (`stuck` is `{action, repeat_count}`, `effects` is lowercase strings): both are guesses, since Appendix A shows only `null` and `[]`. They are acceptable as long as the orchestrator knows P0-03/Body packets will build against them. Both are flagged in the coder report.
- Deviation 7 (numeric types): `health` as `number` and `hunger`/`armor` as `integer`, each 0-20, matches the packet bounds. Fine.
- Other invented bounds with no Appendix A source: `agents[].name` 1-32, `health_estimate` maxLength 32, `entities[].direction` `^[a-z_]{1,16}$`, `current_plan` string maxLength 256/64. `current_plan` and `stuck` are optional and nullable, which matches the packet.
- `buildTypes` (`generator.ts`) de-duplicates declarations by name and silently keeps the first. If P0-02/03/04 define a clashing `$defs` name differently, one is dropped without a warning. A throw on a name clash with different text would be safer, but nothing clashes today.
- Checked and fine: every Appendix A field is present with the packet bounds and `revision` is required; the four marked blocks are present with only the P0-01 block filled; `Co-Authored` aside, the pins are exact in `package.json` and the lockfile (ajv 8.20.0, ajv-formats 3.0.1, json-schema-to-typescript 16.0.0); generated files are LF only, with the banner line first; schemas load sorted by name; `.gitattributes` enforces `eol=lf` so `findStale` is stable on Windows checkouts; all files are well under 700 lines (the 78 KB `validators.js` is 4 lines); biome ignores `generated`; `findStale` is compared in-process, so editing a schema without regenerating fails the drift test.