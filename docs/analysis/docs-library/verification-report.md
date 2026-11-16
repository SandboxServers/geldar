---
title: Library verification report
type: reference
audience: contributors
status: draft
last_verified: 2026-11-16 against 02e9ee34
companions: [RESUME.md, plan.md, ../../agents/doc-verification.md, ../../agents/doc-update-map.md, ../../agents/documentation-style.md]
sources: [docs, docs/agents/doc-verification.md, docs/agents/doc-update-map.md, prompts, animus/src/prompts, player-core/src, threshold/mcp/src, threshold/mcp-mock/src, golem/src/books, plugin/core/src/main/resources, .claude/skills]
---

# Library verification report

The W7 closing sweep of the documentation library: links and anchors, metadata, staleness, forbidden content, agent-read paths, index coverage and counts. The first sweep ran on 2026-11-16 at `3f07a4be` with the edits of all three W7 writers in place (uncommitted). After the two closing reviews and the fix pass, sections 1, 2, 3, 5, 6 and 7 and the library rows of section 4 were re-run on 2026-11-16 at `02e9ee34` (the PR #563 merge, whose tree equals `3f07a4be`: `git diff --stat 3f07a4be 02e9ee34` prints nothing), on the working tree with every W7 edit in place. The procedure each check follows is in [doc verification](../../agents/doc-verification.md); what is still open is in the [RESUME](RESUME.md#debt-after-w7).

## Summary

| # | Check | Result |
|---|---|---|
| 1 | Broken relative links and anchors outside `docs/analysis/` | **0** links, **0** anchors |
| 1 | Broken relative links in `docs/analysis/` | **29** in 16 files (known, finding F-6); 0 broken anchors |
| 2 | Metadata lint, 122 documents | **0** failures; 1 warning (`docs/glossary.md` has no `sources:`, a pointer page) |
| 3 | Staleness sweep | **40** documents stale; **0** warnings |
| 4 | Forbidden content in lines the library wrote | **0** real hits after the fix pass; pattern hits read and benign ([section 4](#4-forbidden-content)) |
| 4 | Forbidden content in lines others wrote | Non-zero; listed by area in [section 4](#4-forbidden-content) |
| 5 | Agent-read paths that reference `docs/` or operator documents | **0** in the documented path list; 3 references in development skills, 1 config comment, 1 code comment |
| 6 | Documents missing from their section index, `docs/README.md` or the update map | **0** (the three legal texts have no section index by design) |
| 7 | Decision records, runbooks, status | 187 records (highest 0366); 29 runbooks plus the index; every library document `draft` |

## Not run

- `./geldar.ps1 pnpm check:repo` (the repo gates). The brief allows no local full runs; CI runs it. Not run.
- Anything on the node, the VM, the database or the world (plan decision D8). Not run.
- Sibling repos (the kit, the player template): out of scope (plan decision D2). Not run.
- The first sweep ran at `3f07a4be`, which contains PR #551 (`git merge-base --is-ancestor 6cf3c957 HEAD` succeeds). HEAD has since moved to the merge commit `02e9ee34` (PR #563); its tree is the same, and the re-runs used it.

## Debts fixed before the sweep

| Debt | Change |
|---|---|
| (a) No reference page for `telemetry/` | New [telemetry-package](../../reference/telemetry-package.md) (reference, `agents-never`; see the note below). Rows added in the [reference index](../../reference/README.md), [repo-layout](../../reference/repo-layout.md) (`telemetry/` row, measured at `3f07a4be`), the [update map](../../agents/doc-update-map.md) telemetry row and the [docs index](../../README.md). Cross-links from [components](../../reference/components.md) and [telemetry-pipeline](../../architecture/telemetry-pipeline.md), whose stale "no package" row was corrected. |
| (b) `threat-model.md` `sources:` not resolvable | Six `decisions/...` entries rewritten as `docs/decisions/...`; all 12 entries exist (`test -e`), and the sweep prints no warning for the file. |
| (c) `ideas.md` has no metadata block | Block added; body unchanged. No test or gate reads the file (`git grep -n ideas -- tools .github geldar.ps1 '*.test.ts'` finds only the issue and PR templates' links). |
| (d) Stale *planned* marks | Removed from `runbooks/add-a-decision-record.md` (decisions by topic) and `runbooks/backup-and-restore.md` (privacy and data retention). One more found and closed: the first debt bullet of the [siblings index](../../siblings/README.md). `git grep -n '\*planned\*' -- docs ':!docs/analysis'` now finds one line, the closed bullet in the siblings index, which quotes the old mark. |
| (e) Anchor `#debt-after-w7` | The heading "Debt after W7" exists in the [RESUME](RESUME.md#debt-after-w7); the anchor resolves (anchor check below). |

**Audience deviations from the brief.** The brief asked for `audience: contributors` on the telemetry page. The [documentation style](../../agents/documentation-style.md#audience-labels) says every document about telemetry is `agents-never`, and the package's content helpers exist to carry the large text that decision 0350 captures. The page is labelled `agents-never` and marked **(a-n)** in every index. `docs/ideas.md` is also labelled `agents-never`: both of its idea rows are Kino ideas. After the safety review, five more were relabelled `agents-never`: `operations/failure-modes.md`, `operations/node-facts.md`, `reference/database-schema.md`, `reference/geldar-core-plugin.md` and `reference/animus-mind.md`. The owner or the orchestrator can change any of these labels ([RESUME, item 12](RESUME.md#open-for-the-owner)).

## 1. Links and anchors

Command, file links: the [relative links](../../agents/doc-verification.md#relative-links) block, run as written over `git ls-files -co --exclude-standard -- 'docs/*.md'`.

```text
total=29 outside-analysis=0
```

Anchors: no documented block checks them, so a one-off read-only Python script did (not committed: Markdown only; a checker is a coder packet under decision 0365). It strips fenced and inline code, takes every `](target)` that has no URL scheme, and for a `.md` target with `#fragment` builds the target's heading slugs the GitHub way (lowercase, punctuation dropped, spaces to hyphens, `-1`, `-2` for repeats) plus any `<a id>` or `<a name>`.

```text
links checked: 5723 (all of docs/, analysis included; re-run at 02e9ee34 after the fix pass)
links with a fragment: 1378
broken file targets: 29 in 16 files (all under docs/analysis/)
broken anchors: 0
```

Broken file links in `docs/analysis/`, by file:

| File | Broken |
|---|---|
| `docs/analysis/harness/README.md` | 3 |
| `docs/analysis/harness/work-packets-geldar-c.md` | 1 |
| `docs/analysis/phase1/packets/c7c-packets.md` | 4 |
| `docs/analysis/phase1/packets/c7d-packets.md` | 4 |
| `docs/analysis/phase1/phase0-retrospective-for-phase1.md` | 1 |
| `docs/analysis/phase1/worknotes/C2-00.md` | 1 |
| `docs/analysis/phase1/worknotes/C2-02.md` | 1 |
| `docs/analysis/phase1/worknotes/C2-04.md` | 1 |
| `docs/analysis/phase1/worknotes/FX-JOURNAL.md` | 1 |
| `docs/analysis/phase1/worknotes/FX-RUNTIME.md` | 1 |
| `docs/analysis/phase1/worknotes/P1-C1-00.md` | 1 |
| `docs/analysis/phase1/worknotes/P1-C1-03.md` | 2 |
| `docs/analysis/phase1/worknotes/P1-C1-06a.md` | 3 |
| `docs/analysis/phase1/worknotes/P1-C1-06c.md` | 3 |
| `docs/analysis/phase1/worknotes/P1-C2b-00.md` | 1 |
| `docs/analysis/phase1/worknotes/P1-C2b-01.md` | 1 |
| **16 files** | **29** |

## 2. Metadata lint

Scope: every document under `docs/` outside `decisions/`, `analysis/` and `legal/` and other than `spec.md` (119), plus the three files in `docs/analysis/docs-library/` (`plan.md`, `RESUME.md`, this report) = 122. (The first sweep wrote 123 here; the sum was off by one.) Rules from the [style](../../agents/documentation-style.md#metadata-block) and decision [0360](../../decisions/0360-documentation-metadata-block-and-sources-field.md):

- `title`, `type`, `audience`, `status`, `last_verified`, `companions` present and non-empty;
- `type` in tutorial, how-to, reference, explanation; `audience` in owner, operators, contributors, players, agents-never, and `players` only on `docs/players/README.md`; `status` in draft, verified, stale;
- `last_verified` matches `YYYY-MM-DD against <sha>` and the sha is a commit here (`git cat-file -e <sha>^{commit}`);
- every `companions` entry exists relative to the document; every `sources:` entry exists, repo-relative or `./`/`../`-relative.

```text
failures: 0
warnings: 1
  docs/glossary.md: no sources field   (pointer page that cites no file; allowed by 0360 point 2)
```

The [metadata present](../../agents/doc-verification.md#metadata-present) block, run as written:

```text
docs/legal/acceptable-use.md
docs/legal/privacy.md
docs/legal/terms.md
```

These three carry no block on purpose ([style](../../agents/documentation-style.md#metadata-block)). `docs/ideas.md` no longer appears.

## 3. Staleness sweep

Command: the [staleness sweep](../../agents/doc-verification.md#staleness-sweep) block, run as written (output collected, then counted). It diffs committed history only (`git diff <sha>..HEAD`), so the uncommitted W7 edits do not count.

```text
lines: 40; STALE: 40; WARNING: 0
```

Ten documents are stale because a **code or config** source changed. Every one of those changes is PR #551 (cards T-03; `git log --oneline cd4499da..HEAD -- pnpm-workspace.yaml pnpm-lock.yaml tools/repo-checks/src/release-dates.json telemetry` lists only `T-03` commits):

| Document | Pinned | Changed sources |
|---|---|---|
| `architecture/build-and-release.md` | `1b114276` | `pnpm-workspace.yaml` |
| `architecture/repo-map-and-dependencies.md` | `1b114276` | `pnpm-workspace.yaml`, `tools/repo-checks/src/release-dates.json` |
| `reference/ci-workflows.md` | `1b114276` | `pnpm-lock.yaml`, `pnpm-workspace.yaml` (and `docs/runbooks/colo-deploy.md`) |
| `reference/cli-tools.md` | `1b114276` | `tools/repo-checks/src/release-dates.json` |
| `reference/environment-variables.md` | `1b114276` | `tools/repo-checks/src/release-dates.json` |
| `reference/repo-checks.md` | `1b114276` | `pnpm-lock.yaml`, `tools/repo-checks/src/release-dates.json` (and four documents) |
| `reference/repo-layout.md` | `cd4499da` | `pnpm-workspace.yaml`, `telemetry/README.md`, `telemetry/package.json`, `tools/repo-checks/src/release-dates.json` |
| `reference/skills-and-agents.md` | `1b114276` | `pnpm-lock.yaml` |
| `reference/third-party-plugins.md` | `1b114276` | `tools/repo-checks/src/release-dates.json` (and `docs/decisions/README.md`) |
| `runbooks/coreprotect.md` | `cd4499da` | `tools/repo-checks/src/release-dates.json` |

Thirty documents are stale only because a **document** in their `sources:` changed after their pin (later waves editing indexes, runbooks and decisions 0350, 0352 and 0360 to 0366):

`architecture/deployment-topology-colo.md`, `architecture/nats-topology.md`, `architecture/telemetry-pipeline.md`, `concepts/observation-and-privacy.md`, `concepts/principles-in-practice.md`, `guides/README.md`, `history/README.md`, `operations/README.md`, `operations/capacity-and-cost.md`, `operations/failure-modes.md`, `operations/node-facts.md`, `reference/deploy-scripts.md`, `reference/geldar-core-plugin.md`, `reference/glass-and-kino.md`, `reference/glossary.md`, `reference/prompt-templates.md`, `reference/spec-section-map.md`, `reference/supervisor-and-body-helper.md`, `reference/velocity-identity-plugin.md`, `runbooks/README.md`, `runbooks/add-a-decision-record.md`, `runbooks/backup-and-restore.md`, `runbooks/incident-response.md`, `runbooks/open-signup.md`, `runbooks/retire-an-agent.md`, `runbooks/rotate-secrets-by-role.md`, `security/README.md`, `security/agent-visibility-rules.md`, `security/authn-authz-map.md`, `security/privacy-and-data-retention.md` (all under `docs/`).

Section indexes list their own folder as a source, so every later edit inside the folder marks the index stale; that accounts for five of the thirty.

## 4. Forbidden content

Scope: every `.md` under `docs/` (642 files before this report). Each hit line is attributed with `git blame --porcelain`: "library" means the line is uncommitted (W7) or comes from the library commits `cd4499da`, `1b114276`, `b6d720d8`, `d82a3368`, `db33805c`, `dc07e3fa`, `283d5d2d` or `3f07a4be`; "other" means any other commit.

| Scan | Pattern | Library lines | Other lines |
|---|---|---|---|
| IPv4 dotted quads other than `127.0.0.1` and `0.0.0.0` | `\b(?:\d{1,3}\.){3}\d{1,3}\b` | 0 | 7 |
| Emails other than the approved abuse address | `[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}` | 0 | 7 |
| Coordinator session labels | withheld (persona rule 3) | 0 | 256 |
| Host aliases | withheld (persona rule 3) | 1 | 2 |
| Home paths | Windows user folder, `/home/`, `/Users/`, user config folder | 0 | 13 |
| Secret-shaped runs | base64-shaped run of 32 or more characters with upper, lower and digits, or hex that is not 40, 64 or 128 long | 0 | 0 |
| Secret assignments | `(?i)(api[_-]?key\|secret\|password\|token)\s*[:=]\s*\S{12,}` | 2 | 5 |
| Withheld-topic vocabulary (two scans) | withheld (decision 0361, D9) | 0 that go beyond spec 8.4 (re-read after the fix pass) | 38 (first sweep) |
| The owner's first name | withheld (persona rule 3) | 0 | 38 |

Every library hit, read by eye:

- Host alias, 1: a Node.js build target in `reference/supervisor-and-body-helper.md` line 199, not a host. Benign.
- Secret assignments, 2: `runbooks/rotate-secrets-by-role.md` line 207 and `security/secrets-by-role.md` line 32 are a link label and a script path. No value. Benign.
- Withheld-topic vocabulary: after the fix pass, every library line that uses it restates spec 8.4 at the spec's own level or uses an ordinary word in another sense (re-read 2026-11-16 after the fix pass).

Lines others wrote, by area (not edited here; reported for the owner and the coordinators):

| Scan | Where |
|---|---|
| IPv4 | Documentation ranges and the loopback network only: `decisions/0132` (4, the IPv4 literal policy itself), `analysis/genesis/plan.md`, `analysis/phase1/worknotes/C7-05.md`, `analysis/phase1/worknotes/FX-IPCHECK.md`. No routable address. |
| Email | Commit-trailer `noreply` addresses in four `analysis/phase0/worknotes/reports/` files (7 lines). |
| Session labels | `decisions/` records (53 lines, among them 0350 and 0352, which this library may not edit) and `decisions/README.md` (16 rows); `analysis/` in 11 campaigns (187 lines). |
| Host aliases | `analysis/phase1/packets/c7f-packets.md`, `analysis/phase1/worknotes/C7-03c2.md`. |
| Home paths | Nine `analysis/` files in `harness/`, `genesis/`, `phase0/` and `phase1/` (13 lines). |
| Secret assignments | Placeholders and file-provider references, no values: `analysis/harness/worknotes/AN-11b.md` (2), `analysis/phase0/worknotes/wm-live-findings.md`, `analysis/telemetry/collector-design.md` (2). |
| Withheld-topic vocabulary | `spec.md`, pre-library decision records, one pre-library runbook line, `threat-model.md` (an ordinary word), and `analysis/` files. |
| Owner's first name | `spec.md` on 25 lines (26 matches; finding F-16, owner only). The other 12 matches are ordinary uses of a common word and file paths; none is the owner's name in a published page. |

## 5. Agent-read paths

The documented [agents-never placement](../../agents/doc-verification.md#agents-never-placement) grep, run as written, plus `golem/src/books` (present in this checkout):

```text
git grep -nE 'docs/' -- <the 14 documented paths>   -> exit=1 (no hits)
git grep -nE 'docs/' -- golem/src/books             -> exit=1 (no hits)
```

The wider list from the brief (`prompts`, `.claude/skills`, `threshold/mcp/src`, `threshold/mcp-mock/src`, `player-core/src`, `animus/src/prompts`, `golem/src/books`, `plugin/core/src/main/resources` and the plugin `speech` and `maintenance` packages), excluding tests:

| Hit | Where | Reading |
|---|---|---|
| `docs/analysis/...`, `docs/decisions/...` | `.claude/skills/body-bench`, `campaign-packet`, `run-shard`, `ship-pr` (9 lines) | Development-session skills, not read by agents in the world. No operator document named. |
| `docs/runbooks/block-owner.md` | `plugin/core/src/main/resources/config.yml` line 36, a YAML comment | Server config; the runbook is `operators`, not `agents-never`. |
| `docs/analysis/phase0/worknotes/...` | `threshold/mcp/src/events/present.ts` line 7, a code comment | Source comment, not tool text. |

Operator vocabulary in the same paths (Glass, Kino, Thought Stream, telemetry, vitals, the collector product, watched, `agents-never`, `(a-n)`, operator-only, observation), excluding tests: 29 lines, all in server-side code comments, identifiers and config comments (`threshold/mcp/src/cli.ts`, `main.ts`, `metrics.ts`, `ports.ts`, `presence.ts`, `world.ts`, `events/stream.ts`; `plugin/core/src/main/resources/config.yml` line 26), or the belief kind "observation" in `prompts/reflection/v1.md` and `v2.md`, `animus/src/prompts/decode-schema.ts` and `player-core/src/ports/memory.ts`, which means "you saw it yourself". None is text that tells an agent it is watched. Whether server code comments count as agent-readable is not settled by any rule; the [paths table](../../agents/documentation-style.md#paths-an-agent-reads) lists tool and prompt text, not comments.

## 6. Index coverage

- Section index: every `.md` under `docs/` outside `analysis/` and `decisions/` that sits in a folder with a `README.md` is linked from that README. Misses: **0**. The three legal texts sit in `docs/legal/`, which has no README by design; `docs/README.md` links the folder, and the player guide, the update map and the privacy page link the files.
- `docs/README.md`: links every top-level document (`ideas.md`, `glossary.md`, `spec.md`, `threat-model.md`) and every section index. Misses: **0**. It links 87 deeper documents only through their section index, which the brief's rule allows.
- [Update-map coverage](../../agents/doc-verification.md#update-map-coverage) block, run as written: `checked=123 unmapped=0` (re-run at 02e9ee34 after the fix pass; the 123 are every `.md` outside `decisions/` and `analysis/`, legal texts and the spec included).
- Index columns against front matter: every section index row whose Audience cell names one document matches that document's `audience:` (scripted compare after the W7 relabels, 2026-11-16).

## 7. Counts

| Figure | Value | Command |
|---|---|---|
| `.md` files under `docs/` | 643 with this report (re-run at 02e9ee34; decision 0364 renamed, not added) | `git ls-files -co --exclude-standard -- 'docs/*.md'`, existing files only |
| Per folder (`.md`) | root 5, agents 4, analysis 332, architecture 9, concepts 12, decisions 188, guides 5, history 6, legal 3, operations 5, players 1, reference 33, runbooks 30, security 6, siblings 4 | same, grouped by second path segment |
| `docs/analysis/` | 14 areas, 336 tracked files (337 with this untracked report) | `ls docs/analysis`; `git ls-files docs/analysis` |
| Decision records | **187**, highest 0366 | [re-derive block 1](../../agents/doc-verification.md#re-derive-lists) |
| Runbooks | **29** plus the index (30 files, all tracked) | `git ls-files docs/runbooks` |
| Reference documents | 32 plus the index (one untracked: `telemetry-package.md`) | `git ls-files -co --exclude-standard docs/reference` |
| Status, 122 documents in the metadata scope | **draft 122**, verified 0, stale 0 | metadata lint, re-run at 02e9ee34 after the fix pass |
| Audience | contributors 52, operators 32, agents-never 25, owner 12, players 1 | metadata lint (first sweep, 119 documents: 53, 35, 20, 10, 1) |
| Type | reference 56, how-to 32, explanation 29, tutorial 5 | metadata lint |

## Follow-ups

- Re-verify the 40 stale documents after W7 merges (W6 merged as PR #563) ([RESUME, How to continue](RESUME.md#how-to-continue), step 3). The ten code-stale ones need only a check that PR #551 changed nothing they state, except [repo-layout](../../reference/repo-layout.md), whose other rows also predate it.
- Fix the 29 campaign links when their campaigns next edit them (finding F-6).
- Session labels in decisions 0350 and 0352 and the decisions index: records 0001 to 0352 are not the library's to edit; an owner-approved format fix or a later record is the owner's call.
- A link, anchor and metadata checker in CI is decision [0365](../../decisions/0365-docs-gates-after-the-freeze.md); the script used here was a one-off and is not in the repo.
