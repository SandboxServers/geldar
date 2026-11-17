---
title: Documentation style
type: reference
audience: contributors
status: draft
last_verified: 2026-11-16 against 3f07a4be
companions: [README.md, doc-update-map.md, doc-verification.md, ../security/agent-visibility-rules.md, ../analysis/docs-library/plan.md]
sources: [.claude/agents/documentation-writer.md, .gitattributes, contract/src/agent-text.ts, contract/test/agent-visible-text.test.ts, animus/src/prompts, animus/src/prompts/agent-text.test.ts, player-core/src, player-core/README.md, threshold/mcp/src/tools/act.ts, threshold/register/scripts/gen-legal.ts, docs/decisions, docs/history, tools/mcp-tokens/src/persona-lint.ts, tools/mcp-tokens/src/persona-export.ts, threshold/mcp-mock/src/prompts.ts, threshold/mcp-mock/README.md, threshold/mcp/src/resources.ts, threshold/mcp/src/world-session.ts, tools/repo-checks/src/open-signup-runbook.test.ts, docs/spec.md, docs/decisions/0042-path-rule-case-folded-identity-prefix.md, docs/decisions/0068-prompt-v4-and-agent-visible-text.md, docs/decisions/0132-ipv4-literal-policy.md]
---

# Documentation style

The rules every page under `docs/` follows: the metadata block, the four document types and where each lives, voice, evidence, audience labels, and where a document must never be placed. The rules come from the documentation-writer persona ([`.claude/agents/documentation-writer.md`](../../.claude/agents/documentation-writer.md)) and the owner's approved plan ([plan.md](../analysis/docs-library/plan.md), decisions D1 to D12).

To find which documents a change must update, use the [doc-update map](doc-update-map.md). To check a document before review, use [doc verification](doc-verification.md).

## Metadata block

Every new document under `docs/` starts with this block, before the first heading:

```yaml
---
title: <name>
type: tutorial | how-to | reference | explanation
audience: owner | operators | contributors | players | agents-never
status: draft | verified | stale
last_verified: <YYYY-MM-DD> against <commit sha>
companions: [<relative links>]
sources: [<comma-separated paths the claims rest on>]
---
```

| Field | Rule |
|---|---|
| `title` | The document's name, the same words as its first heading. |
| `type` | Exactly one of the four types below. A document never mixes types. |
| `audience` | One label from the audience table below. |
| `status` | `draft` until a reviewer passes it; `verified` only after a reviewer has passed it against the commit in `last_verified`; `stale` when a staleness sweep finds a source changed since then. A writer's own check that every cited file exists is not a review and never sets `verified` (the runbooks index records it in a separate column). |
| `last_verified` | The date and the short commit sha the claims were checked against. |
| `companions` | Relative links to the documents of the other types on the same subject. |
| `sources` | Required for any document that cites files (review ruling, 2026-11-16; decision [0360](../decisions/0360-documentation-metadata-block-and-sources-field.md), Proposed). Leave it out only when the document cites no file, as in a pointer page such as `docs/glossary.md`. A reviewer reports a document that cites files without it as a finding. A comma-separated list of paths: repo-relative (`sql/0006_owner_cap_trigger.sql`) or relative to the document, starting `./` or `../` (`../decisions/0132-ipv4-literal-policy.md`). A folder is allowed (`tools/repo-checks/src`). No prose, section numbers, globs or "decision NNNN" in the list: the sweep cannot read them. Put that detail in the body. A staleness sweep diffs these paths since the `last_verified` sha ([doc verification](doc-verification.md#staleness-sweep)). |

The `sources:` field is an addition the owner approved on 2026-11-16 (plan decision D5). The persona file's own copy of the block does not list it yet; adding it there is the owner's edit, not a writer's.

**One documented exception.** `docs/runbooks/open-signup.md` cites the folder `../decisions` instead of its two decision files. Its gate, `tools/repo-checks/src/open-signup-runbook.test.ts`, fails on any run of 32 or more characters from `[A-Za-z0-9+/_-]` anywhere in the file, and every decision file path is such a run. The body names the decisions (0261 and 0153). Any other runbook a test scans for long runs gets the same treatment; check the test before you add a path.

The decision records under `docs/decisions/` carry no metadata block (plan decision D4): a record is never rewritten ([decisions README](../decisions/README.md)). There are 187 of them on 2026-11-16 at 3f07a4be, highest number 0366 (`(git ls-files docs/decisions | Select-String '/\d{4}-').Count`; re-run it rather than copy the figure). The [decisions by topic](../reference/decisions-by-topic.md) digest and the [history](../history/README.md) pages carry the block instead.

Other files with no block:

- The legal texts in `docs/legal/`, on purpose. `threshold/register/scripts/gen-legal.ts` reads each whole file (line 23) into the pages the register service serves, so a block would be served to players (inferred from that line; `legal-pages.test.ts` compares the output).
- `docs/spec.md`, which only the owner edits.
- The working files under `docs/analysis/` (working notes, not a Diataxis type), except the library's own `RESUME.md` and `plan.md`.
- `docs/ideas.md`, a parking list. No rule names it; give it a block when it is next edited.

`docs/threat-model.md` stays at the top of `docs/` with a block added in place (plan decision D10; added in the W7 pass).

## Document types and where they live

Geldar follows Diataxis. Pick one type per document and link to the others through `companions`.

| Type | Use it for | Home in Geldar |
|---|---|---|
| Tutorial | A first walkthrough that ends in a working result | `docs/guides/`, and `docs/players/README.md` for players |
| How-to | A goal with numbered steps; assumes the basics | `docs/runbooks/`; `docs/security/agent-visibility-rules.md` and `docs/agents/doc-verification.md`, which sit next to the rules they apply |
| Reference | Complete and dry: every field, option, route, table or subject | `docs/reference/`, `docs/operations/` (tables), `docs/agents/` (rules and maps), `docs/security/` (secrets by role, the access map), every section `README.md` index, and `docs/history/campaign-index.md` |
| Explanation | Why: design, trade-offs, history | `docs/concepts/`, `docs/architecture/`, `docs/history/`, `docs/decisions/`, and the explanation pages in `docs/security/` and `docs/siblings/` |

A runbook is a how-to. A decision record is an explanation. A schema table is reference. All the section folders exist on 2026-11-16 at 3f07a4be (`ls docs`).

**History pages (review ruling, 2026-11-16).** The pages in `docs/history/` are explanation: they tell how and why the project got where it is, and cite the campaign files and decision records rather than restate them. Two are reference by nature and are labelled so: the folder index and `campaign-index.md` (one row per campaign area). The by-topic digest of decisions is reference too and lives in `docs/reference/decisions-by-topic.md`, not in `docs/history/`. The campaign files under `docs/analysis/` are working notes, not a Diataxis type; they keep no metadata block and stay where they are.

**Folders that mix types.** `docs/security/`, `docs/siblings/` and `docs/history/` hold more than one type. Each document still has exactly one; the section index gives each document's type in a column.

Existing runbooks and `docs/threat-model.md` stay where they are (plan decision D10); the runbooks got the metadata block in place in W0.

## Audience labels

| Label | Reader | Notes |
|---|---|---|
| `owner` | The project owner | Decisions, scope, cost, world-operations exceptions. |
| `operators` | People who run the node and the stack | Runbooks, deploy, secrets by role, failure modes. |
| `contributors` | People and coding agents who change the code | Architecture, reference, process. |
| `players` | Outside human players | Two places only (review ruling, 2026-11-16): the player guide (`docs/players/README.md`) and the legal texts (`docs/legal/`). Nothing else takes this label, even a document players might find useful: [mcp-tools](../reference/mcp-tools.md) is `contributors` until the owner decides. The legal texts carry no block (above), so the label is written only in the player guide. |
| `agents-never` | Operators and the owner. The label adds a restriction: no agent in the world may be given this document | Telemetry, vitals, the Glass, journals, thoughts, prompts, observation. The readers are the same as for `operators`; the label marks where the document must never be placed. See the next section. |

**The label follows the content, not the plan row (review ruling, 2026-11-16).** A document that names thoughts, journals, prompts or another observation surface as part of its subject is `agents-never`, whoever else reads it. Two documents changed label for this reason: [privacy-and-data-retention](../security/privacy-and-data-retention.md) (plan row S03 said `owner`; it lists what is kept about thoughts and journals) and [trace-one-action](../guides/trace-one-action.md) (plan row G03 said `contributors`; it follows a thought, the journal and the `thought` prompt to the Glass). Contributors still read both. The plan rows keep their original value with a note ([plan.md section 5](../analysis/docs-library/plan.md#5-documents)).

## Agents never learn they are watched

An agent in the world must never read text that tells it it is watched, that it is software, or that it is in a test (persona rule 5; decisions [0058](../decisions/0058-the-character-knowledge-boundary-and-thought-v2.md), [0059](../decisions/0059-identity-mode-is-about-human-observation-not-agent-belief.md), [0068](../decisions/0068-prompt-v4-and-agent-visible-text.md)).

Rules for documents:

1. Label every document about telemetry, vitals, the Glass, Kino, journals, thoughts, prompts or observation `audience: agents-never`.
2. Never copy, quote or link such a document from a path an agent reads (list below).
3. Keep `agents-never` documents, and any document that mentions observation, at the level the spec already states. Leave out thresholds, delays, hiding rules and detection detail (plan decision D9). The repo is public ([CLAUDE.md](../../CLAUDE.md)), so an agent that can browse the web can read anything in `docs/`. "Spec level" means a sentence says what a surface is and who uses it, as the spec or a decision title does, and not how it works or how it stays unseen. Two examples:
   - At spec level: "The Observatory is everything humans use to watch: the map, dashboards, the thought stream and spectators (spec section 3)."
   - Over the line: "The camera stays out of agents' sight because `<mechanism>`; it shows a thought `<N>` minutes late; an agent could notice it if `<condition>`." Each placeholder is a hiding rule, a delay or a detection detail. Such text belongs nowhere in the repo; point to the decision record instead.
4. Write no operator material into a sibling repo that agents read. Sibling repos are summarised in this repo only (plan decision D2).
5. Do not reproduce the marker-word lists the scans below use; cite the file.

### Paths an agent reads

Checked in this repo at cd4499da on 2026-11-16 unless marked otherwise. The two MCP prompt rows were corrected after the W0 review the same day; the `animus/src/prompts` and `player-core/src` rows were added at 3f07a4be after the W4 security writer found them missing ([agent-visibility rules](../security/agent-visibility-rules.md), gaps recorded, item 1). That page's step 1 table is the longer operator version of this one; keep the two in step.

| Surface | Where it lives | Evidence |
|---|---|---|
| Mind prompt templates | `prompts/` (thought, reflection, body-api) | 18 files listed by `git ls-files prompts`; scanned by `animus/src/prompts/agent-text.test.ts` |
| Text the Mind's prompt code builds | `animus/src/prompts/` (`wake-wording.ts`, `world-text.ts`, `render-snapshot.ts`, `render-memory.ts`, `body-api.ts`) | `wake-wording.ts` line 2 calls its text the wording "as the model reads it (decision 0068)"; `git ls-files animus/src/prompts`, 2026-11-16 at 3f07a4be |
| Output validation, corrective and refusal text | `player-core/src/` (for example `validate/corrective.ts`, the corrective message the model receives) | Imported by `threshold/mcp/src/tools/act.ts` and by `animus` (`player-core/README.md`); `corrective.ts` line 15 builds a `ModelMessage`, 2026-11-16 at 3f07a4be |
| MCP tool list, results and refusals | `contract/schemas/mcp-world`, `mcp-play`, `mcp-common` and `common` `.schema.json`; `threshold/mcp/src/tools/`; `threshold/mcp/src/play-view/` | `contract/test/agent-visible-text.test.ts` names the four schemas as agent-read |
| MCP resources | `threshold/mcp/src/resources.ts` | spec section 5.15.3 lists `geldar://player/self`, `geldar://player/journal/recent`, `geldar://shard/rules` |
| MCP prompts `geldar:play`, `geldar:reflect`, `geldar:newborn` | `threshold/mcp-mock/src/prompts.ts` (named in spec section 5.15.3) | Defined in the mock (`git grep -n 'geldar:play' -- threshold`: lines 17, 22, 27; test in `threshold/mcp-mock/src/app.test.ts` lines 186 to 190). The production server serves the same text: `threshold/mcp/src/resources.ts` re-exports `listPrompts` and wraps `getPrompt` from `@geldar/mcp-mock`, and `threshold/mcp/src/world-session.ts` lines 161 to 162 answer prompt requests with them |
| Mock MCP prompts, resources and tool results | `threshold/mcp-mock/src/` (`prompts.ts`, `resources.ts`, `registry.ts`, the fake world under `sim/` and `corpus/`) | The mock stands in for the Threshold MCP server with the real tool contract (`threshold/mcp-mock/README.md` line 3), and its prompts reach players through the production server (row above). The `prompts.ts` header comment shows the text is written for a player to read |
| Body failure and outcome text | `golem/src/actions/`, `contract/src/outcome-words.ts` | scanned by `golem/src/actions/failure-texts.test.ts` and the contract tests |
| Character engine text | `psyche/` (mirrored into the Mind kit) | `psyche/README.md`; `psyche/test/temperament.test.ts` |
| Persona files | A player's `memory/identity.md` and `memory/goals.md`, written by `tools/mcp-tokens` persona export | `tools/mcp-tokens/src/persona-export.ts`; lint in `persona-lint.ts` (decision 0068) |
| Kit files and skills | Sibling repos `geldar-scriptorium` and `geldar-player-template` | spec sections 5.15.4 and 5.15.5; not checked in those repos for this page |
| Player repos | `player-<name>`: `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.claude/skills/`, hooks, `memory/`, `skills/` | spec section 5.15.4; identity rule in decision [0042](../decisions/0042-path-rule-case-folded-identity-prefix.md) |
| In-world text | Signs, books, chat, maintenance notices, skins and names | `golem/src/actions/write-sign.ts`; `plugin/core-common/src/main/java/dev/geldar/core/speech/` and `.../core/maintenance/`; spec section 5.8 |

The development skills and agents in `.claude/` are read by coding agents, not by agents in the world. They still sit in a public repo.

## Voice

- Short sections. Active voice, present tense.
- Second person and numbered steps in a how-to.
- One idea per sentence. Name the file, command or decision, not "the system".
- Plain words. No marketing, no emoji.
- Mermaid for diagrams. No screenshots.
- LF line endings (`.gitattributes` sets `* text=auto eol=lf`; `pnpm check:repo` fails on CRLF or a stray control character).

## Evidence

Every claim names its evidence: a file, a decision number, a commit or a command you ran.

- Date anything measured: counts, sizes, timings, versions. Write the UTC date and the commit.
- Re-check a figure before you copy it from another document. If you cannot, write "unverified" and say where it came from.
- When code, spec and a decision disagree, record all three and flag the conflict. Do not choose one silently (persona rule 8).
- Inferred facts (for example from file names) say "inferred" and from what.

## What never goes in a document

| Never | Instead | Gate today |
|---|---|---|
| A secret value, or where a secret lives on disk | The secret's role: "the MineSkin key, held by the owner" | `no-credentials.test.ts` and the MCP token scan catch some shapes only |
| An account name or personal name | A role: owner, operator, coordinator | None |
| A public or private-network IP address | A role or a host name placeholder; `127.0.0.1` is fine | `ip-literals` in `pnpm check:repo` (decision [0132](../decisions/0132-ipv4-literal-policy.md)) |
| An email address other than `abuse@sandboxservers.games` | The role | `legal-drafts.test.ts` requires that address in the legal texts; nothing forbids others |
| Content of the owner's private configuration folder | Describe it by role; never read, list or copy it | None |
| Observation detail in a path an agent reads | An `agents-never` document in `docs/` | Agent-text scans cover prompts, contract schemas, persona files and some Body text only |
| An edit to `docs/spec.md` | A decision record under `docs/decisions/` | None (review only) |
| Code, config, tests or prompts | A follow-up item in the writer's report | None (review only) |

## Indexes and cross-links

- Each section folder has a `README.md` index. Adding, renaming or removing a document updates that index in the same change.
- Cross-link both ways: a new document links its companions, and they link back.
- Add a row to the [doc-update map](doc-update-map.md) when a new kind of change needs a document update.
