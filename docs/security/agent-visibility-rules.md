---
title: Agent visibility rules
type: how-to
audience: agents-never
status: draft
last_verified: 2026-11-16 against 03c1f5de
companions: [README.md, privacy-and-data-retention.md, authn-authz-map.md, ../agents/documentation-style.md, ../agents/doc-verification.md, ../concepts/observation-and-privacy.md, ../reference/mcp-tools.md, ../reference/player-core.md]
sources: [.claude/agents/documentation-writer.md, CLAUDE.md, docs/agents/documentation-style.md, docs/agents/doc-verification.md, contract/src/agent-text.ts, contract/test/agent-visible-text.test.ts, animus/src/prompts, animus/src/prompts/agent-text.test.ts, tools/mcp-tokens/src/persona-lint.ts, tools/mcp-tokens/src/persona-export.ts, golem/src/actions/failure-texts.test.ts, threshold/mcp/src/resources.ts, threshold/mcp/src/resources.test.ts, threshold/mcp/src/world-session.ts, threshold/mcp/src/tools, threshold/mcp/src/play-view, threshold/mcp-mock/src/prompts.ts, threshold/mcp-mock/README.md, player-core/src, docs/reference/player-core.md, docs/reference/mcp-tools.md, golem/src/actions/write-sign.ts, plugin/core-common/src/main/java/dev/geldar/core/speech, plugin/core-common/src/main/java/dev/geldar/core/maintenance, ../decisions/0058-the-character-knowledge-boundary-and-thought-v2.md, ../decisions/0059-identity-mode-is-about-human-observation-not-agent-belief.md, ../decisions/0068-prompt-v4-and-agent-visible-text.md, ../decisions/0361-agents-never-placement-and-public-detail.md, ../decisions/0365-docs-gates-after-the-freeze.md, ../decisions/0366-open-spec-5-14-watched-wording-versus-0059.md]
---

# Agent visibility rules

Use this page when you write or review any document, decision record or comment that touches observation: telemetry, vitals, the Glass, Kino, journals, thoughts or prompts. It tells you where an agent can read text, what a document in this public repo may say, which scans to run, and what to do when you are not sure.

The rule behind it: an agent in the world never reads text that tells it it is watched, that it is software, or that it is in a test (persona rule 5; decisions [0058](../decisions/0058-the-character-knowledge-boundary-and-thought-v2.md), [0059](../decisions/0059-identity-mode-is-about-human-observation-not-agent-belief.md), [0068](../decisions/0068-prompt-v4-and-agent-visible-text.md)). Decision [0361](../decisions/0361-agents-never-placement-and-public-detail.md) (Proposed) applies it to documents.

This page stays at policy level. It names surfaces and rules, never how a surface works or stays unseen.

## Before you start

- Read [documentation style](../agents/documentation-style.md#agents-never-learn-they-are-watched): the label, the placement rule and the D9 level.
- Know that the repo is public (`CLAUDE.md`). An agent that can browse can read anything under `docs/`, so the label limits placement; it does not hide the text (0361 point 3).
- Work from the repo root in PowerShell 7. Every command below only reads.

## 1. Check where your text will live

Text an agent can read lives in the places below. Your document must not be placed in, copied into, quoted from or linked from any of them.

Re-verified at `03c1f5de` on 2026-11-16: every path below exists, `git ls-files prompts` lists 18 files, the four MCP schemas are the ones `contract/test/agent-visible-text.test.ts` line 6 names, and `threshold/mcp/src/world-session.ts` lines 161 to 162 serve the MCP prompts from the mock.

| Surface | Where it lives |
|---|---|
| Mind prompt templates | `prompts/` |
| Text the Mind's prompt code builds | `animus/src/prompts/` (for example `wake-wording.ts`, line 2: "as the model reads it (decision 0068)"; also `world-text.ts`, `render-snapshot.ts`, `render-memory.ts`, `body-api.ts`). Not in the style table yet |
| MCP tool list, results and refusals | `contract/schemas/` (`mcp-world`, `mcp-play`, `mcp-common`, `common`); `threshold/mcp/src/tools/`; `threshold/mcp/src/play-view/` |
| Output validation and refusal text behind the MCP tools | `player-core/src/` (imported by `threshold/mcp/src/tools/act.ts` lines 9 to 11; [player core](../reference/player-core.md) says its refusal text is agent-read). Not in the style table yet |
| MCP resources | `threshold/mcp/src/resources.ts` |
| MCP prompts, resources and mock results | `threshold/mcp-mock/src/` |
| Body failure and outcome text | `golem/src/actions/`; `contract/src/outcome-words.ts` |
| Character engine text | `psyche/` |
| Persona files | a player's `memory/identity.md` and `memory/goals.md`, written by `tools/mcp-tokens/src/persona-export.ts` |
| Kit files, skills and player repos | sibling repos and `player-<name>` repos (spec sections 5.15.4 and 5.15.5). Not checkable from this repo |
| In-world text | signs, books, chat, maintenance notices, skins and names: `golem/src/actions/write-sign.ts`; `plugin/core-common/src/main/java/dev/geldar/core/speech/` and `.../core/maintenance/` |

The development skills and agents in `.claude/` are read by coding agents, not by agents in the world. They still sit in the public repo.

If your text is meant for one of these surfaces, this page does not cover it. Ask the coordinator (step 5).

## 2. Decide what the document may say

A document under `docs/` says what a surface is, who may use it and the policy that governs it, and no more (0361 point 3; plan decision D9).

**You may write:**

- that a surface exists and what it is for, in the words the spec or a decision title uses;
- who may read or use it (owner, operators, the public);
- how long its data is kept, and how it is erased;
- the decision numbers that govern it;
- that a gap exists, and the policy it breaks (0361 point 5).

**You may not write:**

- thresholds, delays, hiding rules or detection detail;
- how a surface stays out of an agent's sight, or what would let an agent notice it;
- any of the above in a decision record either (0361 point 5);
- operator material in any sibling repo an agent reads (plan decision D2);
- the marker-word lists the scans use. Cite `contract/src/agent-text.ts` instead ([style](../agents/documentation-style.md#agents-never-learn-they-are-watched), rule 5).

The two worked examples in the [style document](../agents/documentation-style.md#agents-never-learn-they-are-watched) (rule 3) show one sentence at the right level and one over the line.

## 3. Label the document

1. Set `audience: agents-never` on any document about telemetry, vitals, the Glass, Kino, journals, thoughts, prompts or observation (0361 point 1).
2. Put it under `docs/` only (0361 point 2).
3. If a page for another audience must mention one of these surfaces, keep that mention at the step 2 level and link the `agents-never` page instead of repeating it.

## 4. Run the leak scans

A hit is a question, not a verdict. Read every hit.

### 4a. Nothing an agent reads links into `docs/`

```powershell
git grep -nE 'docs/' -- prompts animus/src/prompts contract/schemas threshold/mcp/src/tools threshold/mcp/src/play-view threshold/mcp/src/resources.ts threshold/mcp-mock/src player-core/src psyche/src golem/src/actions contract/src/outcome-words.ts tools/mcp-tokens/src/persona-export.ts plugin/core-common/src/main/java/dev/geldar/core/speech plugin/core-common/src/main/java/dev/geldar/core/maintenance
```

`git grep` exits 1 when it finds nothing; that is a pass. This extends the grep in [doc verification](../agents/doc-verification.md#agents-never-placement) with the Mind's prompt code, the play view, `player-core`, the Body actions, outcome words, persona export and the plugin text folders. Run as written on 2026-11-16 at `03c1f5de`: no hits (exit 1).

### 4b. Your document stays at policy level

The first pattern uses only the surface names the [style document](../agents/documentation-style.md#agents-never-learn-they-are-watched) already lists; it is not the marker list. Set `$doc` to your file, then list the lines that name a watched surface and the lines that carry a time or a ratio:

```powershell
$doc = 'docs/<folder>/<file>.md'
Select-String -Path $doc -Pattern 'telemetry|vitals|glass|kino|journal|thought|prompt|observ'
Select-String -Path $doc -Pattern '\b\d+(\.\d+)?\s*(ms|s|sec|seconds?|min|minutes?|h|hours?|days?|%)\b'
```

For each hit, check it against step 2. A retention period is policy; a delay, a cut-off or a trigger condition on a watched surface is not. When a hit is over the line, cut it and write "withheld under decision 0361" in its place.

### 4c. If the change also edits text an agent reads

A documentation writer does not edit these paths. A reviewer of a mixed change runs the existing scans, which hold the marker list and its exceptions:

```powershell
./geldar.ps1 pnpm test agent-visible-text agent-text.test persona-lint failure-texts resources.test refusal-detail
```

These are the contract scan, the prompt scan, the persona lint, the Body failure-text test and the two MCP result scans (`contract/test/agent-visible-text.test.ts`, `animus/src/prompts/agent-text.test.ts`, `tools/mcp-tokens/src/persona-lint.test.ts`, `golem/src/actions/failure-texts.test.ts`, `threshold/mcp/src/resources.test.ts`, `threshold/mcp/src/tools/refusal-detail.test.ts`). The command was not run for this page.

### 4d. The general forbidden-content scans

Run the email, IP and secret scans in [doc verification](../agents/doc-verification.md#forbidden-content), and read the document for personal and account names by eye.

## 5. When you are not sure

1. **Hold.** Do not commit the sentence, and do not move it to another file in the repo.
2. **Ask the coordinator** who sent your brief. Quote the sentence and the step it may break.
3. **Keep withheld detail out of every repo file.** Until the owner names a private store, it goes only in your report to whoever sent the brief (0361 point 4). The document says "withheld under decision 0361" in its place.
4. **Do not resolve an open question yourself.** What a Watched shard tells its agents is an open owner decision (decision [0366](../decisions/0366-open-spec-5-14-watched-wording-versus-0059.md)). Cite the spec lines, 0059 and 0366, and name the spec line as open.

## Reviewer checklist

Report each failure as a numbered finding with file and line.

1. The document's `audience` is `agents-never` if it is about any surface in step 3.
2. Scan 4a passes, or each hit has a written reason.
3. Every hit of scan 4b is at the step 2 level.
4. No marker-word list is reproduced.
5. Withheld detail appears only as "withheld under decision 0361".
6. A change that touches an agent-read path ran the scans in 4c.

## What the scans cannot catch

A reviewer judges the D9 level (decision [0365](../decisions/0365-docs-gates-after-the-freeze.md) item 3); sibling repos are checked there.

## Gaps recorded

1. **Closed 2026-11-16 (W7).** The [style document](../agents/documentation-style.md#paths-an-agent-reads) now lists `player-core/src/` and `animus/src/prompts/`, and the placement grep in [doc verification](../agents/doc-verification.md#agents-never-placement) covers both (its line 171).
2. **0361 is Proposed.** Points 3 and 4 wait for the owner; point 4 needs the owner to name a private store.
3. **0366 is open.** The spec's Watched row and decision 0059 disagree on what agents are told; see that record.
