---
title: Doc verification
type: how-to
audience: contributors
status: draft
last_verified: 2026-11-16 against cd4499da
companions: [README.md, documentation-style.md, doc-update-map.md, ../analysis/docs-library/plan.md]
sources: [.claude/agents/documentation-writer.md, package.json, tools/repo-checks/src/run-checks.ts, pnpm-workspace.yaml, .github/workflows/ci.yml]
---

# Doc verification

How to check one document before review, how to sweep the library for stale documents, and how to re-derive the lists other documents cite. The rules being checked are in [documentation style](documentation-style.md); which documents a change touches is in the [doc-update map](doc-update-map.md).

Every command below is PowerShell 7, run from the repo root. Each one reads only; none touches the node, the VM, the database or the world. They were run on 2026-11-16 at cd4499da.

## Verify one document

1. Note the commit you verify against:

   ```powershell
   git rev-parse --short HEAD
   ```

2. Check the metadata block: all fields present, one `type`, one `audience`, `last_verified` in the form `YYYY-MM-DD against <sha>`, and `sources:` listing, comma-separated, the paths the claims rest on.
3. For each claim, open the cited file, decision or commit and confirm it says what the document says. Re-run any command the document quotes and compare the output. A measured figure carries its date and commit.
4. When you cannot confirm a claim, mark it "unverified" and name where it came from. When code, spec and a decision disagree, record all three and flag the conflict.
5. Run the [mechanical scans](#mechanical-scans) on the document.
6. Walk the [review checklist](#review-checklist).
7. Check that the section `README.md` lists the document, that its companions link back, and that the [doc-update map](doc-update-map.md) has a row for any new kind of change it covers.
8. Set `last_verified` to today's date and the sha from step 1. Set `status: verified` only after a reviewer passes it; until then leave `status: draft`. A writer's own check that every cited file exists is not a review: record it in the section index (for example the "References checked by writer" column of the [runbooks index](../runbooks/README.md)), never in `status`.

## Staleness sweep

A document is stale when a file in its `sources:` list changed after the commit in its `last_verified`. The sweep lists those documents.

It reads `sources:` as a comma-separated list of paths. Each entry is a repo-relative path (`sql/0006_owner_cap_trigger.sql`) or a path relative to the document that starts with `./` or `../`. A folder is a valid entry. Prose, section numbers, globs and "decision NNNN" are not paths. Prose and "decision NNNN" produce a warning; a glob produces none, but the sweep does not handle it reliably, so name the folder instead.

The sweep prints two kinds of line:

- `STALE <document>: <changed paths>` means a source changed since `last_verified`. Handle it with the steps after the block.
- `WARNING: <document>: source '<entry>' is not a path in this checkout` means the sweep could not read that entry, so it cannot tell whether the document is stale. Fix the `sources:` list.

No output at all means every document with a readable `sources:` list is fresh. It says nothing about documents with no `sources:` list or no `last_verified` sha: the sweep skips those silently.

```powershell
$root = git rev-parse --show-toplevel
foreach ($f in git ls-files -co --exclude-standard -- 'docs/*.md') {
  $head = Get-Content $f -TotalCount 15
  if ($head[0] -ne '---') { continue }
  $sha = $head | ForEach-Object { if ($_ -match '^last_verified: \S+ against (\w+)') { $Matches[1] } }
  $list = $head | ForEach-Object { if ($_ -match '^sources: \[(.*)\]') { $Matches[1] } }
  if (-not $sha -or -not $list) { continue }
  $paths = @(foreach ($s in $list -split ',\s*') {
    $p = if ($s -match '^\.\.?/') { Join-Path (Split-Path $f) $s } else { $s }
    if (Test-Path $p) { [IO.Path]::GetRelativePath($root, (Resolve-Path $p).Path) -replace '\\', '/' }
    else { Write-Warning "${f}: source '$s' is not a path in this checkout" }
  })
  if ($paths.Count -eq 0) { continue }
  $changed = git diff --name-only "$sha..HEAD" -- $paths
  if ($changed) { "STALE ${f}: $($changed -join ', ')" }
}
```

For each `STALE` line:

1. Read the diff of the named sources since the sha: `git diff <sha>..HEAD -- <path>`.
2. If the document still holds, update `last_verified` only.
3. If it does not, fix the document, or set `status: stale` and file the debt in the campaign's `RESUME.md`.

A document with no `sources:` list cannot be swept. Add one when you next verify it.

## Mechanical scans

### Repo gates

```powershell
./geldar.ps1 pnpm check:repo
```

This runs the line-ending, control-character, IP-literal, MCP-token and decision-index gates over every file, `docs/` included. The [gates table](doc-update-map.md#gates-that-read-documents) says what each checks in documents. The document gates that live in Vitest (legal texts, gated runbooks, the player guide) run with `pnpm test` in CI; run one file locally with, for example, `./geldar.ps1 pnpm --filter @geldar/repo-checks exec vitest run src/legal-drafts.test.ts`.

### Relative links

No gate checks links (plan decision D7 proposes one). This lists links under `docs/` whose target file does not exist. It ignores anchors, code spans and fenced blocks.

```powershell
foreach ($f in git ls-files -co --exclude-standard -- 'docs/*.md') {
  $text = (Get-Content -Raw $f) -replace '(?s)```.*?```', '' -replace '`[^`\n]*`', ''
  foreach ($m in [regex]::Matches($text, '\]\(([^)\s]+)')) {
    $t = $m.Groups[1].Value
    if ($t -match '^[a-z][a-z0-9+.-]*:' -or $t.StartsWith('#')) { continue }
    $p = [uri]::UnescapeDataString(($t -split '#')[0])
    if ($p -and -not (Test-Path (Join-Path (Split-Path $f) $p))) { "${f}: $t" }
  }
}
```

A link to a document the plan schedules but has not written is expected; it is marked *planned* in the text. Anything else is a broken link to fix.

### Metadata present

Lists documents outside `docs/decisions/`, `docs/analysis/` and `docs/spec.md` that do not start with the metadata block (decision records carry none by plan decision D4).

```powershell
git ls-files -co --exclude-standard -- 'docs/*.md' |
  Where-Object { $_ -notmatch '^docs/(decisions|analysis)/' -and $_ -ne 'docs/spec.md' } |
  Where-Object { (Get-Content $_ -TotalCount 1) -ne '---' }
```

### Forbidden content

These catch the shapes the gates do not. Read every hit; a hit is a question, not a verdict.

```powershell
# Email addresses other than the one approved address
git grep -nE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' -- 'docs/*.md' |
  Select-String -NotMatch 'abuse@sandboxservers\.games|noreply@'

# Dotted quads other than loopback (the ip-literals gate covers addresses; this also shows versions)
git grep -nE '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b' -- 'docs/*.md' ':!docs/analysis' |
  Select-String -NotMatch '127\.0\.0\.1|0\.0\.0\.0'

# Words that suggest a secret value or a secret's location on disk
git grep -niE '(api[_-]?key|secret|password|token)\s*[:=]\s*\S{12,}' -- 'docs/*.md'
```

`git grep` exits 1 when it finds nothing; that is a pass. On 2026-11-16 at cd4499da the email scan's only other hits were commit-trailer `noreply@` addresses in `docs/analysis/`, now excluded above, and the secret scan hit four lines in `docs/analysis/` that name placeholders or file paths, not values.

Also search the document for personal names and account names by eye; no pattern catches them reliably.

### Agents-never placement

An `agents-never` document must not be linked or quoted from a path an agent reads ([style](documentation-style.md#paths-an-agent-reads)). Check the agent-read paths in this repo for links into `docs/`:

```powershell
git grep -nE 'docs/' -- prompts contract/schemas threshold/mcp/src/tools threshold/mcp/src/resources.ts threshold/mcp-mock/src psyche/src
```

Any hit needs a reason. On 2026-11-16 at cd4499da there were none (`threshold/mcp-mock/src` added after the W0 review; still none). Sibling repos (the kit, the player template) are checked in those repos, not here.

## Re-derive lists

Documents that cite a count or a list re-run the command that produced it and date the result. The analysis counts (block 4) change as soon as a new folder appears under `docs/analysis/`: `Get-ChildItem` counts it on disk at once, `git ls-files` only after its files are committed.

```powershell
# 1. Decision records, highest number, index rows whose status starts "Proposed"
(git ls-files docs/decisions | Select-String '/\d{4}-').Count
git ls-files docs/decisions | ForEach-Object { if ($_ -match '/(\d{4})-') { $Matches[1] } } | Sort-Object | Select-Object -Last 1
(Get-Content docs/decisions/README.md | Where-Object { $_ -match '^\|\s*\*{0,2}\[\d{4}\]' -and ($_ -split '\|')[-2].Trim() -match '^Proposed' }).Count
# 2. Runbooks, migration numbers, prompt files, workflows
(git ls-files docs/runbooks).Count
git ls-files sql | ForEach-Object { if ($_ -match '^sql/(\d{4})_') { $Matches[1] } }
git ls-files prompts
(git ls-files .github/workflows).Count
# 3. Tools, repo-check modules and tests, workspace packages
(Get-ChildItem tools -Directory).Name
(git ls-files tools/repo-checks/src | Where-Object { $_ -match '\.ts$' -and $_ -notmatch '\.test\.ts$' }).Count
(git ls-files tools/repo-checks/src | Where-Object { $_ -match '\.test\.ts$' }).Count
Get-Content pnpm-workspace.yaml | Where-Object { $_ -match '^\s+- ' }
# 4. Analysis areas with file counts, campaign RESUME files
Get-ChildItem docs/analysis -Directory | ForEach-Object { "$($_.Name)=$((git ls-files "docs/analysis/$($_.Name)").Count)" }
git ls-files docs/analysis | Select-String 'RESUME\.md$'
```

Write the result into the document that cites it, with the date and the commit. The results of the run on 2026-11-16 at cd4499da are in [plan.md section 13.1](../analysis/docs-library/plan.md#131-re-derived-lists).

## Review checklist

The persona's review mode. Report numbered findings with file and line.

1. **Type.** One Diataxis type, matching the folder. No steps in a reference, no reference tables in a tutorial.
2. **Audience.** The label fits the reader. Anything about observation is `agents-never`.
3. **Metadata.** Block present and complete; `last_verified` names a real commit.
4. **Evidence.** Every claim cites a file, decision, commit or command; measured figures are dated; unverifiable ones say "unverified" and where they came from.
5. **Conflicts.** Disagreements between code, spec and decisions are recorded, not resolved silently.
6. **Links.** Every relative link resolves, or is marked *planned*.
7. **Forbidden content.** No secret, secret location, account name, personal name, IP address or unapproved email (persona rules 3 and 4).
8. **Agent visibility.** Nothing an agent reads links to or quotes the document; an `agents-never` document stays at spec level (no thresholds, delays, hiding rules or detection detail; plan decision D9).
9. **Principle 1.** A human acting in the world appears only as a bounded, decision-backed exception.
10. **Index and map.** The section `README.md` lists the document; the [doc-update map](doc-update-map.md) covers the change.
11. **Form.** LF endings, Mermaid for diagrams, short sections, active voice.
