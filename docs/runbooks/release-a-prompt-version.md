---
title: Release a prompt version
type: how-to
audience: agents-never
status: draft
last_verified: 2026-11-16 against 03c1f5de
companions: [README.md, ../reference/prompt-templates.md, ../reference/animus-mind.md, ../reference/shard-config.md, ../agents/documentation-style.md, ../agents/doc-update-map.md]
sources: [prompts/README.md, CLAUDE.md, docs/spec.md, animus/src/prompts/library.ts, animus/src/prompts/library.test.ts, animus/src/prompts/agent-text.test.ts, animus/src/prompts/body-api.ts, animus/src/config.ts, animus/src/main.ts, animus/src/loop/journal-row.ts, animus/src/memory/journal.ts, animus/src/reflection/reflect.ts, shards/phase0.yaml, shards/colo-mind.yaml, golem/src/mind-link/body-api.test.ts, sql/0001_init.sql, docs/analysis/phase1/packets/decision-number-registry.md]
---

# Release a prompt version

Ship a change to a Mind prompt template as a new numbered file under `prompts/`, make it the default if it should be, and prove the old versions are untouched. Never edit a released template in place: every thought records the template version it used ([CLAUDE.md](../../CLAUDE.md); spec Appendix D, the `thoughts.prompt_template_version` column).

**Audience: agents-never.** Templates are a path an agent reads ([documentation style](../agents/documentation-style.md#paths-an-agent-reads)). Never link, copy or quote this page from `prompts/` or any other agent-read path. This page quotes no template text and does not list the words the agent-text scan looks for; read the test file.

Every command below is PowerShell 7, run from the repo root. Checked at 03c1f5de on 2026-11-16. No database was read (plan decision D8); steps that need one are marked *untested*.

## Before you start

- Read [prompt templates](../reference/prompt-templates.md): the three kinds (`thought`, `reflection`, `body-api`), the file layout, every version and its reason.
- Read [prompts/README.md](../../prompts/README.md), section "Rules".
- Know who loads the files: the in-house Mind (`animus/`) at start (`createPromptLibrary`, `animus/src/prompts/library.ts`). The in-house Mind is off on the Colo until a Thinker path exists (decision [0134](../decisions/0134-mind-is-a-profile-until-a-thinker-exists.md)). Sovereign players' MCP prompts are separate files and are not covered here ([prompt templates](../reference/prompt-templates.md#who-reads-them)).
- A new `{{slot}}` is a code change, not only a prompt change: the library refuses any slot its renderer does not know (`prompts/README.md`; `THOUGHT_SLOTS` and `REFLECTION_SLOTS` in `library.ts`).

## Steps

1. **Pick the version number.** It is the next integer for that kind. At 03c1f5de: `thought` v1 to v5, `reflection` v1 to v2, `body-api` v1 to v10 and v12 (`git ls-files prompts`; v11 is not in the repo, AN-45b reserves it). Check reservations before you take one: on 2026-11-10 the Phase 1 registry reserved `thought` v6 and v7 for two packets ([decision-number registry](../analysis/phase1/packets/decision-number-registry.md), "Prompt version reservation"). Neither file exists at 03c1f5de, and whether those reservations still hold is unverified; ask the orchestrator.

2. **Copy the current default to the new file.** For example, for the thought template:

   ```powershell
   Copy-Item prompts/thought/v5.md prompts/thought/v6.md
   ```

   The defaults at 03c1f5de are `DEFAULT_THOUGHT_VERSION = 5`, `DEFAULT_REFLECTION_VERSION = 2` and `DEFAULT_BODY_API_VERSION = 10` (`animus/src/prompts/library.ts` lines 135 to 138). While `body_actions.building` is on, the Mind renders body-api v12 instead (`bodyApiVersionFor`, lines 138 to 142). The file name must be `v<N>.md` (thought, reflection) or `v<N>.json` (body-api): the library builds the path from the number (`createPromptLibrary`).

3. **Edit only the new file.** Keep the layout: `<<block N>>` lines, the blocks each kind needs, the `<<variant degraded>>` section in a reflection, and only known slots. In a `body-api` file, set the `version` field to the new N; the loader requires a number but does not compare it with the file name (`animus/src/prompts/body-api.ts`), so nothing catches a stale value (the `body-api/v8.json` history shows one: [prompt templates](../reference/prompt-templates.md#conflicts-recorded), item 5). Follow the in-world-text and no-model-identity rules in `prompts/README.md`.

4. **Pin the new file's hash.** Released files are pinned by SHA-256 in `animus/src/prompts/library.test.ts` (the test "keeps the bytes of the released templates unchanged"). Add your file to that map once its text is final:

   ```powershell
   (Get-FileHash prompts/thought/v6.md -Algorithm SHA256).Hash.ToLower()
   ```

5. **Make it the default, if it should be.**
   - Change the matching `DEFAULT_*_VERSION` constant in `animus/src/prompts/library.ts`.
   - For `thought`, also set `mind.thought_version` in `shards/phase0.yaml` and `shards/colo-mind.yaml` (both `5` at 03c1f5de) and their "v1 to v5 exist" comments. `animus/src/main.ts` passes the thought version from the shard file. The reflection version comes from its constant alone; the body-api version comes from its constant or, with `body_actions.building` on, from `bodyApiVersionFor`.
   - Update the default list in `animus/src/prompts/agent-text.test.ts` (`DEFAULT_TEMPLATES`) so the scan covers the new default, and the default assertions in `library.test.ts`.
   - Update the listing in `prompts/README.md` (the new file's line, and "the default" moved to it) and its "Running with these templates" paragraph.

6. **Add a behaviour test.** A behaviour change needs a test that fails when reverted ([CLAUDE.md](../../CLAUDE.md)). The existing pattern renders the library and asserts the new wording is in the expected block (for example the "renders the knowledge, sleep and anti-loop rules in block 1 of thought v2" case in `library.test.ts`).

7. **Record why.** If a decision drives the change, cite it in the `prompts/README.md` line and in [prompt templates](../reference/prompt-templates.md#version-history). The repo has no rule that every version needs a record (reflection v2 and thought v3 have none), but a change to what an agent is told usually settles a design question: see [add a decision record](add-a-decision-record.md).

8. **Update the documents** from the [doc-update map](../agents/doc-update-map.md) row "A new version under `prompts/`": `prompts/README.md` and [prompt templates](../reference/prompt-templates.md) (its kinds table, version history and slots).

## Verify

```powershell
./geldar.ps1 pnpm exec vitest run animus/src/prompts/library.test.ts animus/src/prompts/agent-text.test.ts
git diff --name-status origin/main -- prompts
```

- Both test files pass. The hash test fails if any released file changed by a single byte. The command above passed on 2026-11-16 09:22 UTC at 03c1f5de, before any change (2 files, 35 tests; re-run in the W3 fix pass).
- The diff lists only `A` (added) lines for new `vN` files, plus `M` for `prompts/README.md`. An `M` line on a `vN` file means a released template was edited: undo it.
- *Untested.* After the next Mind start, new rows in `thoughts` carry `prompt_template_version` of the form `thought@<N>+sha256:<12 hex>` (`animus/src/loop/journal-row.ts`; `animus/src/memory/journal.ts`). A running Mind keeps the version it loaded (`prompts/README.md`). Do not start a Mind just to check this; the repo rules on `adam up` are in [CLAUDE.md](../../CLAUDE.md).

## Roll back

- **Not yet merged or never run:** revert the commit.
- **Merged:** point the default back (the `DEFAULT_*_VERSION` constant, and `mind.thought_version` for `thought`) in a new change. Keep the new file: once it may have produced a thought it is released and stays loadable. Whether it has produced a thought is visible only in the `thoughts` table (D8, unverified from the repo).
- The change takes effect at the next Mind start.

## Conflicts recorded

1. **The body-api version is not stored per thought.** `prompts/README.md` says every thought carries the `prompt_template_version` of the template it used. The value stored is the thought (or reflection) template's version (`templateVersion` in `library.ts` line 422, written by `journal-row.ts` and `reflect.ts`). The library computes a `bodyApiVersion` id, but at 03c1f5de nothing outside tests and fakes reads it (`git grep -n bodyApiVersion -- animus/src player-core/src`, inferred). The body-api text reaches the record only inside `model_input`.
2. **Accepted thought versions.** [prompt templates](../reference/prompt-templates.md#who-reads-them) says `animus/src/config.ts` accepts 1 to 5. The code sets a minimum of 1 and no maximum (`optionalInt(mind, 'thought_version', 'mind', 5, 1)`); a version with no file fails when the library loads it.
3. **The Body check uses an old body-api file.** `golem/src/mind-link/body-api.test.ts` checks `body-api/v2.json` against the Body, not the default v10. A new body-api version is not checked against the Body by that test.

## Related

- Reference: [prompt templates](../reference/prompt-templates.md), [animus Mind](../reference/animus-mind.md), [shard config](../reference/shard-config.md).
- Concepts: [observation and privacy](../concepts/observation-and-privacy.md), [character and memory](../concepts/character-and-memory.md).
