---
title: Add a contract schema
type: how-to
audience: contributors
status: draft
last_verified: 2026-11-16 against 03c1f5de
companions: [README.md, ../reference/contract-schemas.md, ../reference/mcp-tools.md, ../reference/nats-subjects.md, ../reference/repo-checks.md, ../agents/documentation-style.md, ../agents/doc-update-map.md]
sources: [CLAUDE.md, contract/package.json, contract/scripts/generate.ts, contract/scripts/generator.ts, contract/src/index.ts, contract/test/agent-visible-text.test.ts, contract/test/maintenance-notice.test.ts, contract/schemas/maintenance-notice.schema.json, package.json, geldar.ps1, .github/workflows/ci.yml, biome.json, vitest.config.ts, plugin/core/build.gradle.kts, docs/decisions/0001-contract-json-schema.md, docs/analysis/phase1/packet-conventions.md]
---

# Add a contract schema

Add a new JSON Schema to `contract/schemas/`, or change an existing one, then regenerate the TypeScript types and validators and commit both. The rule is in [CLAUDE.md](../../CLAUDE.md): **change the contract, never the generated code.** CI fails when the generated code is out of date.

Every command below is PowerShell 7, run from the repo root. Checked at 03c1f5de on 2026-11-16. Steps marked *(not run for this page)* write files; they were read from the code, not executed.

## Before you start

- Read [contract schemas](../reference/contract-schemas.md): the package, the generator, every existing schema and which ones an agent reads.
- Decision [0001](../decisions/0001-contract-json-schema.md) is why the contract exists: one JSON Schema (draft 2020-12) per message that crosses a component boundary, code generated from it, generated output committed. When a spec appendix and the contract disagree, the contract wins and the spec gets a note.
- In a campaign, one small "unblocker" packet owns `contract/` for its wave and merges before the fan-out packets that use it ([packet conventions](../analysis/phase1/packet-conventions.md) sections 2 and 3). If you are a fan-out packet, request the change; do not make it.
- Run `./geldar.ps1 setup` once if `node_modules` is missing.

## Steps

1. **Create or edit the schema file.** Name it `contract/schemas/<name>.schema.json`. The generator reads only files that end in `.schema.json`, sorted by name (`loadSchemas` in `contract/scripts/generator.ts`). Start from the shape every schema uses, for example `contract/schemas/maintenance-notice.schema.json`:

   ```json
   {
     "$schema": "https://json-schema.org/draft/2020-12/schema",
     "$id": "https://geldar.dev/schemas/<name>.schema.json",
     "title": "<PascalCaseTitle>",
     "description": "<what the message is, who sends it, on which subject>",
     "type": "object",
     "additionalProperties": false,
     "required": [],
     "properties": {}
   }
   ```

   - `$id` must be unique: Ajv adds every schema before it compiles (`buildValidators`).
   - `title` gives the exported type and the validator name `validate<Title>`. Two exports with the same name make the generator throw `duplicate validator export` (`validatorExports`).
   - `additionalProperties` is set per schema. Set it to `false` if unknown fields must be refused; nothing adds it for you ([contract schemas](../reference/contract-schemas.md#package)).
   - Refer to another file with a relative `$ref` such as `common.schema.json#/$defs/LifeId`. Cross-file refs resolve from `contract/schemas/` only.
   - Ajv runs with `strict: true` (`buildValidators`). An unknown keyword fails generation.
   - JSON files count toward the 500 and 700 line caps ([CLAUDE.md](../../CLAUDE.md); `pnpm check:repo`).

2. **For an MCP tool, follow the tool pairing.** A tool is a pair of `$defs` named `<Name>Input` and `<Name>Result` in the same file. The tool name is the snake case of `<Name>` (`ReadBook` becomes `read_book`). The `Input` definition needs a non-empty `description`, which is the tool's description. An unpaired definition, or an `Input` with no description, makes the generator throw (`toolPairs`). A schema listed in `NOT_YET_EXPOSED` keeps its validators but stays out of the tool list (`contract/scripts/generator.ts` line 108).

3. **Keep agent-read text clean.** Tool text, results and refusals are read by agents in the world ([documentation style](../agents/documentation-style.md#paths-an-agent-reads)). Every `description` and `const` string in `mcp-world`, `mcp-play`, `mcp-common` and `common`, and every definition the generated tool list reaches, is scanned for marker words by `contract/test/agent-visible-text.test.ts`. Do not link or quote any `docs/` page from a schema.

4. **Regenerate** *(not run for this page)*:

   ```powershell
   ./geldar.ps1 pnpm --filter @geldar/contract generate
   ```

   This runs `node scripts/generate.ts` (`contract/package.json`) and prints `wrote <path>` for each of the four generated files: `src/generated/types.ts`, `src/generated/validators.js`, `src/generated/validators.d.ts` and `src/generated/mcp-tools.ts` (`generate` in `contract/scripts/generator.ts`). Never edit those files by hand; each starts with `// Generated by contract/scripts/generate.ts. Do not edit.` Biome skips them (`!**/generated` in `biome.json`).

5. **Export a typed validator if callers need one.** `contract/src/index.ts` wraps the raw Ajv validators in `validate<Name>(value)` functions that never throw and return `{ ok, value }` or `{ ok: false, errors }`. Add yours in its own marked block (the file header asks each packet to fill only its own block). Callers can also import the raw validator from `src/generated/validators.js`, as `contract/test/maintenance-notice.test.ts` does.

6. **Write the test.** Add `contract/test/<name>.test.ts`. Cover each accepted shape and each refused one; `contract/test/maintenance-notice.test.ts` is a short model. A behaviour change needs a test that fails when the change is reverted ([CLAUDE.md](../../CLAUDE.md)). Vitest picks up any `**/test/**/*.test.ts` (`vitest.config.ts`).

7. **If the Paper plugin reads the schema**, run the plugin build. Gradle passes `contract/schemas` to the plugin's tests as the `geldar.schemas` system property (`plugin/core/build.gradle.kts` line 41), and Java tests such as `EventSchemaCheck` validate against those files.

   ```powershell
   cd plugin; ./gradlew build; cd ..
   ```

8. **Update the documents** in the same change. The [doc-update map](../agents/doc-update-map.md) row for `contract/schemas/*` lists them: [contract schemas](../reference/contract-schemas.md) always; [mcp-tools](../reference/mcp-tools.md) for an `mcp-*` schema; [nats-subjects](../reference/nats-subjects.md) for a new subject; [data-flow-events](../architecture/data-flow-events.md) for a new event.

## Verify

Run the targeted checks. CI runs the full set; you do not need a full local run.

```powershell
./geldar.ps1 pnpm --filter @geldar/contract check:generated
./geldar.ps1 pnpm exec vitest run contract/test/<name>.test.ts contract/test/agent-visible-text.test.ts
./geldar.ps1 pnpm --filter @geldar/contract typecheck
```

- The drift check prints `contract/src/generated is up to date.` and exits 0. On drift it prints `out of date: <path>` per stale file and exits 1 (`contract/scripts/generate.ts`). Run on 2026-11-16 at 03c1f5de: up to date (re-run at 09:22 UTC in the W3 fix pass with `node scripts/generate.ts --check` in `contract/`).
- CI runs the same drift check as the step "generated code is up to date (contract drift)" (`.github/workflows/ci.yml` lines 45 to 46). `./geldar.ps1 check` runs it as "generated code is up to date" (`geldar.ps1` line 152). The root script `pnpm check:generated` runs `check:generated` in every package that has one; at 03c1f5de only `contract` has one.
- `git status` shows your schema, your test, and the generated files changed together.

## Roll back

- **Before merge:** revert the schema change and run step 4 again, or drop the commit. The drift check must pass afterwards.
- **After merge:** schemas have no version field; consumers read the current files. Remove or loosen the schema in a new change, regenerate, and update every caller the typecheck flags. When a field leaves a message other services still send, ship the consumer change first.

## Failure messages

| Message | Cause | Fix |
|---|---|---|
| `out of date: src/generated/<file>` | Generated output differs from the schemas | Step 4, then commit the output |
| `duplicate validator export validate<Name>` | Two schemas or definitions produce the same export name | Rename a `title` or a `$defs` entry |
| `<Name>Input has no description` | Tool input without a description | Add the description |
| `<Name>Input has no <Name>Result` (or the reverse) | Unpaired tool definition | Add the missing half in the same file |
| `<Name>Input and <Name>Result must live in the same schema file` | Pair split across files | Move one |
| `$ref <ref> names a missing schema file` or `names a missing definition` | A broken `$ref` in a tool bundle | Fix the reference |

All messages are from `contract/scripts/generator.ts` and `contract/scripts/generate.ts`.

## Related

- Reference: [contract schemas](../reference/contract-schemas.md), [MCP tools](../reference/mcp-tools.md), [NATS subjects](../reference/nats-subjects.md), [repo checks](../reference/repo-checks.md).
- Decision: [0001](../decisions/0001-contract-json-schema.md).
- Next how-to for storage changes: [add a migration](add-a-migration.md).
