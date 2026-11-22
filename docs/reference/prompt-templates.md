---
title: Prompt templates
type: reference
audience: agents-never
status: draft
last_verified: 2026-11-16 against 1b114276
companions: [README.md, ../runbooks/release-a-prompt-version.md, animus-mind.md, ../concepts/character-and-memory.md, ../concepts/observation-and-privacy.md]
sources: [prompts, animus/src/prompts/library.ts, animus/src/prompts/template.ts, animus/src/prompts/library.test.ts, animus/src/prompts/agent-text.test.ts, animus/src/main.ts, animus/src/config.ts, shards/phase0.yaml, shards/colo-mind.yaml, golem/src/mind-link/body-api.test.ts, docs/spec.md, docs/decisions/README.md]
---

# Prompt templates

Every versioned template under `prompts/`: what each kind is for, how a file is laid out, every version with the change it made and the decision behind it, and how a version is released. This page describes structure and changes only. It does not quote template text; read the files.

**Audience: agents-never.** The templates are a path an agent reads ([documentation style](../agents/documentation-style.md#paths-an-agent-reads)). Never link, copy or quote this page from `prompts/`, from any other agent-read path, or from a sibling repo.

Everything below was read from the files in `sources:` at commit `1b114276` on 2026-11-16, with the commands in [Re-derive](#re-derive).

Related: [animus-mind](animus-mind.md), [character-and-memory](../concepts/character-and-memory.md) and [observation-and-privacy](../concepts/observation-and-privacy.md). The how-to: [release-a-prompt-version](../runbooks/release-a-prompt-version.md).

## The three kinds

| Kind | Files | Purpose | Spec | Default at 1b114276 |
|---|---|---|---|---|
| `thought` | `thought/v1.md` to `v5.md` | The Mind's prompt for one thought: system message (blocks 1 to 4) and user message (blocks 5 and 6). | Appendix B.1 | v5 (`DEFAULT_THOUGHT_VERSION` in `animus/src/prompts/library.ts`) |
| `reflection` | `reflection/v1.md`, `v2.md` | The sleep reflection: system message (blocks 1 and 2), user message (block 3), and a `degraded` variant used when the Mind is tired. | Appendix B.2 | v2 (`DEFAULT_REFLECTION_VERSION`) |
| `body-api` | `body-api/v1.json` to `v10.json`, `v12.json` (no `v11.json`) | The allow-list of verbs and programs the Mind may ask the Body for, one example each; rendered into the thought prompt's `{{body_api_table}}` slot. | Appendix B.1 (the `body_api_table` slot) | v10 (`DEFAULT_BODY_API_VERSION`); v12 (`BUILDING_BODY_API_VERSION`) while `body_actions.building` is on |

18 templates and a README at 784b4f27: thought v1 to v5, reflection v1 and v2, body-api v1 to v10 and v12 (`git ls-files prompts`).

## Who reads them

- The Mind (`animus/`) loads them at start through `createPromptLibrary` (`animus/src/prompts/library.ts`); the parser is `animus/src/prompts/template.ts`. Nothing is built or served (`prompts/README.md`).
- `animus/src/main.ts` passes `thoughtVersion`, from `mind.thought_version` in the shard file (`5` in `shards/phase0.yaml` and `shards/colo-mind.yaml`; `animus/src/config.ts` line 222 reads it with `optionalInt(mind, 'thought_version', 'mind', 5, 1)`: default 5, minimum 1, no maximum; a version with no file fails when the library loads it, see [release-a-prompt-version](../runbooks/release-a-prompt-version.md) conflict 2). The reflection version is the library default; no config key selects it (`git grep -n reflection_version -- shards animus/src` finds nothing). The body-api version is `DEFAULT_BODY_API_VERSION` (10), or v12 while `body_actions.building` is on: `bodyApiVersionFor` in `animus/src/prompts/library.ts` takes `buildingOn` from `animus/src/config.ts`, and `animus/src/main.ts` passes the result to `createPromptLibrary`. Removed with animus, decision 0430; nothing renders body-api now (2026-11-22 addendum in decision 0426).
- `golem/src/mind-link/body-api.test.ts` checks a body-api file against the Body.
- The Mind of our own is off on the Colo until a Thinker path exists (decision [0134](../decisions/0134-mind-is-a-profile-until-a-thinker-exists.md)). Sovereign players do not read these files; the MCP prompts they use are separate (`threshold/mcp-mock/src/prompts.ts`, served by `threshold/mcp`).

## File layout

| Rule | Detail | Evidence |
|---|---|---|
| Blocks | A line `<<block N>>` starts block N. Every thought file has blocks 1 to 6; every reflection file has blocks 1 to 3 and `<<variant degraded>>`. | `MARKER` in `template.ts`; `grep -E '^<<' prompts/*/*.md` |
| System and user messages | Thought: blocks 1 to 4 are the system message, the same for every thought of an agent (no times, no counts); blocks 5 and 6 are the user message. Reflection: blocks 1 and 2, then block 3. | `prompts/README.md` |
| Slots | `{{name}}`. The library refuses a template with an unknown slot and a render that leaves one unfilled; values are inserted once and never re-scanned. | `prompts/README.md`; `template.ts` |
| World text | Speech, signs, names and the overheard digest never appear in a template or the system message. They are JSON-escaped strings, one per line, in the one quoted-world-text section at the end of the user message. | `prompts/README.md`; `player-core/src/ports/prompts.ts` |
| Agent-facing text | The default thought, reflection and body-api files are scanned by `animus/src/prompts/agent-text.test.ts`; the test fails on a marker word. The list of words is in that file; this page does not repeat it. | test file; decisions 0058, 0059, 0068 |

### body-api JSON shape

Every `body-api/vN.json` has the same top-level keys: `version` (number, equal to N), `description`, `say` (`summary`, `example`), `verbs` (each `do`, `summary`, `fields`, `example`), `programs` (each `program`, `summary`, `arguments`, `example`) and `wake_on` (`summary`, `values`). Read with `node -e` over the files, 2026-11-16.

## Version identity

A template's version id is `<kind>@<n>+sha256:<12 hex>`: the number from the file name and the first 12 hex characters of the SHA-256 of the file's bytes. The library computes it on load and every thought records it in `prompt_template_version` (`prompts/README.md`; spec Appendix D). `animus/src/prompts/library.test.ts` pins the SHA-256 of the released files it lists; a byte change to any released file fails that test. On 2026-11-16 the `sha256sum` of `thought/v1.md`, `thought/v5.md`, `body-api/v8.json` and `body-api/v10.json` matched their pins.

## Version history

Dates are the UTC dates of the commit that added the file (`git log --diff-filter=A`, with `TZ=UTC` and `--date=format-local`; see [Re-derive](#re-derive)). The commits carry author-local times at UTC-6, so `--date=short` prints an earlier day for several rows. "Default" is the default at 1b114276.

### thought

| Version | Added | Change from the previous version | Decision or packet |
|---|---|---|---|
| v1 | 9cdea3fd, 2026-11-09 | The thought prompt of spec Appendix B.1, blocks 1 to 6. | spec Appendix B.1 |
| v2 | 9d49ca11, 2026-11-10 | See the decision. | [0058](../decisions/0058-the-character-knowledge-boundary-and-thought-v2.md) |
| v3 | 786b087f, 2026-11-10 | See the packet note in `prompts/README.md`. | BC-10 (`prompts/README.md`) |
| v4 | a92b2c93, 2026-11-10 | See the decisions. | [0058](../decisions/0058-the-character-knowledge-boundary-and-thought-v2.md), [0059](../decisions/0059-identity-mode-is-about-human-observation-not-agent-belief.md), [0068](../decisions/0068-prompt-v4-and-agent-visible-text.md) |
| v5 (default) | 20a384d8, 2026-11-10 | See the decision. | [0074](../decisions/0074-shelter-means-an-enclosed-safe-space.md) |

The context window was raised so the till wording fits (decision [0181](../decisions/0181-thought-context-8704.md)).

### reflection

| Version | Added | Change | Decision or packet |
|---|---|---|---|
| v1 | 9cdea3fd, 2026-11-09 | The sleep reflection of spec Appendix B.2, with the degraded variant. | spec Appendix B.2 |
| v2 (default) | e368d96b, 2026-11-10 | Changes in blocks 1 and 3 (`git diff --no-index -U0 prompts/reflection/v1.md prompts/reflection/v2.md`, 2026-11-16). | Commit subject "R4d: commitments flood and reflection v2"; no decision record. Not decision 0058, which keeps reflection at v1 (see [conflict 4](#conflicts-recorded)). |

Degraded path: the validator limits the reflection fields (`prompts/README.md`).

### body-api

Verb and program names are read from the `do` and `program` fields. "Reworded" means the entry's text changed with no change to its name.

| Version | Added | Verbs (count) | Programs | Change from the previous version | Decision or packet |
|---|---|---|---|---|---|
| v1 | 9cdea3fd, 2026-11-09 | `goto`, `mine`, `craft`, `place`, `eat`, `sleep`, `open`, `deposit`, `withdraw`, `attack`, `wait` (11) | `travel`, `gather`, `craft`, `rest`, `flee` | The Phase 0 allow-list. | `prompts/README.md` |
| v2 | 20a384d8, 2026-11-10 | same (11) | same | `sleep` and `rest` reworded; description changed. | [0074](../decisions/0074-shelter-means-an-enclosed-safe-space.md) |
| v3 | 062c8e89, 2026-11-12 | adds `unstick` (12) | same | One verb added. | commit subject: allow unstick in Phase 0 |
| v4 | 50fc92af, 2026-11-12 | adds `give`, `note` (14) | adds `follow` | Most entries shortened; `say` and `wake_on` changed. | C5-04b |
| v5 | cd44d222, 2026-11-12 | adds `write_sign` (15) | adds `build` | Nearly every entry reworded. | C5-07b |
| v6 | 685452e7, 2026-11-12 | same (15) | same | Description only; the new perception fields are in the snapshot, not here. | PX (`prompts/README.md`) |
| v7 | 7361f7b2, 2026-11-14 | adds `till` (16) | same | Several entries reworded; `say` and `wake_on` changed. | [0167](../decisions/0167-till-action.md) |
| v8 | 19e9ae01, 2026-11-14 | adds `edit_sign` (17) | same | One verb added. | [0192](../decisions/0192-edit-sign-action.md) |
| v9 | 955c675a, 2026-11-15 | adds `use` (18) | same | One verb added. | [0218](../decisions/0218-use-mount-dismount-verbs.md) |
| v10 (default) | c1fe2094, 2026-11-15 | same (18) | same | Only the `use` entry reworded. | `prompts/README.md` |
| v12 | 1831ba2b, 2026-11-22 | adds `break` and `plan` (20) | same | Two verbs added and their wording; not the default. Rendered while `body_actions.building` is on (`bodyApiVersionFor`). | BLD-24 (`prompts/README.md`); decision 0425 |

## Release rules

The rules a new version must meet, from `prompts/README.md`, `CLAUDE.md` and the tests. The steps are the how-to [release-a-prompt-version](../runbooks/release-a-prompt-version.md).

| Rule | Detail | Evidence |
|---|---|---|
| Released files are frozen | A template that has produced a thought is never edited. A change is a new file `vN+1`; the old file stays loadable. | `prompts/README.md`; `CLAUDE.md` |
| Checks | The new file passes the library's slot check and the agent-text scan. | `template.ts`; `animus/src/prompts/agent-text.test.ts` |
| Hash pin | Every file's SHA-256 is pinned. | `animus/src/prompts/library.test.ts` |
| Default | The default is the `DEFAULT_*_VERSION` constant; for `thought`, also `mind.thought_version` in the shard files. The listing in `prompts/README.md` changes with it. | `animus/src/prompts/library.ts`; `prompts/README.md` |
| Tests | A behaviour change needs a test that fails when reverted. | `CLAUDE.md` |
| When it applies | On the next Mind start; a running Mind keeps the version it loaded. | `createPromptLibrary` runs at start (`animus/src/main.ts`) |

## Conflicts recorded

1. **Spec section 5.14 (Watched row, line 806) and Appendix B (B.1 near line 1584, B.3 at line 1633) against decisions [0059](../decisions/0059-identity-mode-is-about-human-observation-not-agent-belief.md) and [0068](../decisions/0068-prompt-v4-and-agent-visible-text.md).** Open, owner decision.
2. **Default named by decision 0068.** Its index row says "prompt v4 is the default". Code: thought v5 is the default (decision 0074 moved it). 0068's status is still "Proposed".
3. **Decision 0218 and body-api v9.** 0218 decides three verbs (`use`, `mount`, `dismount`) and says body-api v9 lists each. v9 and v10 list `use` only (`node -e` over the files, 2026-11-16). The `description` field of both files says the ride and mount verbs come later, so they do not reach the Mind through this template.
4. **reflection v2: three accounts.** `prompts/README.md` describes v2 as "v1 with the knowledge rules". Decision [0058](../decisions/0058-the-character-knowledge-boundary-and-thought-v2.md) point 3 says reflection stays at v1. The diff from v1 to v2 changes the `beliefs_remove` wording in block 1 and adds the `commitments` slot to block 3; v1 already carries the knowledge line (commit e368d96b, "R4d: commitments flood and reflection v2"). No decision record covers v2.
5. **Files changed after their first commit.** The rule is that a template that has produced a thought is never edited. Three files have a second commit (UTC dates): `body-api/v1.json` (9cdea3fd, then 6876a827, both 2026-11-09), `body-api/v8.json` (19e9ae01, then 92f52872, which set its `version` field from 7 to 8, both 2026-11-14) and `body-api/v10.json` (c1fe2094, then 319d5be0, eight minutes apart on 2026-11-15). Whether any of them had produced a thought before the second commit is unverified: that needs the `thoughts` table on the node (plan decision D8).

## Doc debt in `prompts/README.md`

- The sentence on agent-facing text appears twice in a row (section "Running with these templates").
- The `body-api/v3.json` row says only "see its description".

## Re-derive

```powershell
git ls-files prompts                                                        # 17 templates and README.md at 1b114276
$env:TZ = 'UTC'; foreach ($f in git ls-files prompts | Where-Object { $_ -ne 'prompts/README.md' }) { "$f $(git log --diff-filter=A --format='%h %ad' --date=format-local:%Y-%m-%d -- $f)" }   # UTC add dates
git diff --no-index -U0 prompts/reflection/v1.md prompts/reflection/v2.md    # reflection v2 change (exit code 1 means a difference)
foreach ($f in git ls-files prompts | Where-Object { $_ -ne 'prompts/README.md' }) { "$f $((git log --format=%h -- $f).Count)" }   # commits per file
node -e "for (let i=1;i<=12;i++){if(i===11)continue;const j=require('./prompts/body-api/v'+i+'.json');console.log(i,j.verbs.map(v=>v.do).join(','),'|',j.programs.map(p=>p.program).join(','))}"
Select-String -Path prompts/thought/*.md, prompts/reflection/*.md -Pattern '^<<'
```
