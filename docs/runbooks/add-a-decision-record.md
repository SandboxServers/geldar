---
title: Add a decision record
type: how-to
audience: contributors
status: draft
last_verified: 2026-11-16 against 03c1f5de
companions: [README.md, ../decisions/README.md, ../reference/repo-checks.md, ../reference/spec-section-map.md, ../agents/doc-update-map.md, merge-queue.md]
sources: [docs/decisions/README.md, tools/repo-checks/src/decision-index.ts, tools/repo-checks/src/decision-rows.ts, tools/repo-checks/src/run-checks.ts, tools/repo-checks/src/cli.ts, .gitattributes, CLAUDE.md, AGENTS.md, .claude/agents/documentation-writer.md, docs/analysis/phase1/packet-conventions.md, docs/analysis/phase0/retro/campaign.md]
---

# Add a decision record

Write one record under `docs/decisions/` when you settle an open spec decision, fill a gap the spec leaves, or choose differently from the spec, and add its row to the decisions index so the two repo gates pass. The spec itself is never edited for this: [CLAUDE.md](../../CLAUDE.md) says to settle it in a record and say so in the PR.

Every command below is PowerShell 7, run from the repo root. Checked at 03c1f5de on 2026-11-16.

## Before you start

- Read the header of [docs/decisions/README.md](../decisions/README.md): what a record is for, the naming rule and the template.
- A decision that is still open belongs in the campaign ledger that needs it, not in a record (decisions README, first paragraph). An owner decision is never guessed: the ledger marks it blocked and the orchestrator asks the owner ([AGENTS.md](../../AGENTS.md)).
- A record is never rewritten to say something else. A later record supersedes it, and only the old record's status line changes to `Superseded by NNNN` (decisions README, second paragraph).

## Steps

1. **Get a number.** Do not just take the next free one. Parallel branches that each did that collided on 0066 in Phase 0 ([Phase 0 retrospective](../analysis/phase0/retro/campaign.md) section 4.6). The practice since then: the orchestrator reserves a block of numbers per campaign or wave, and a packet uses only the numbers in its brief ([packet conventions](../analysis/phase1/packet-conventions.md) section 6). The documentation-writer persona says the same: ask the orchestrator for the next free number ([.claude/agents/documentation-writer.md](../../.claude/agents/documentation-writer.md), rule 1). Gaps in the sequence are fine. Then check the number is unused on `main`:

   ```powershell
   git fetch origin main
   git ls-tree --name-only origin/main docs/decisions/ | Select-String '/NNNN-'
   ```

   No output means the number is free on `main`. It may still be taken on another open branch; the reservation is what protects you.

2. **Create the file** `docs/decisions/NNNN-short-slug.md`: four digits, a hyphen, then a short slug (the README's convention is lower case with hyphens; the gate only requires four digits, a hyphen and `.md`). Any other `.md` file in `docs/decisions/` except `README.md` fails the decision-index gate, and so does a `.md` file in a subfolder. The gate reads tracked files and untracked files that git does not ignore (`git ls-files --others --exclude-standard`, `tools/repo-checks/src/cli.ts` line 42).

3. **Write the record** from the README template:

   ```markdown
   # NNNN. Title

   - Status: Accepted | Superseded by NNNN
   - Date: YYYY-MM-DD
   - Spec: section or open-decision number this settles

   ## Decision
   ## Why
   ## Consequences
   ```

   Records carry no metadata block (documentation plan decision D4; [documentation style](../agents/documentation-style.md#metadata-block)). Keep secrets, account names and network addresses out: the repo is public. A record about observation stays at spec level ([documentation style](../agents/documentation-style.md#agents-never-learn-they-are-watched)).

4. **Add the index row** to the table in `docs/decisions/README.md`:

   ```markdown
   | [NNNN](NNNN-short-slug.md) | One-line summary of the decision | Status |
   ```

   Put the row in number order, not at the end if a higher number is already listed. `.gitattributes` gives the README `merge=union`, so two branches that each add a row keep both on merge; the rows gate then catches a row that landed out of order or twice.

5. **Supersede, if this record replaces one.** Change only the old record's `Status:` line to `Superseded by NNNN`, and its index row's status cell to match. Leave the rest of the old record as it is.

6. **Update the documents** from the [doc-update map](../agents/doc-update-map.md) row "A new decision record": the index row (gated); [spec-section-map](../reference/spec-section-map.md) when the record names a spec section; the concept or architecture page whose design it changes; the "Design and decisions" cell in [components](../reference/components.md) for a key decision. Say in the PR that the record settles a spec question.

## What the two gates require

Both run in `pnpm check:repo` over tracked files and untracked files that are not ignored (`tools/repo-checks/src/run-checks.ts`, lines 67 to 69 and 212 to 220). An untracked record with no row fails locally too.

### decision-index (`tools/repo-checks/src/decision-index.ts`)

- Every file in `docs/decisions/` named `NNNN-<anything>.md` (four digits, a hyphen, no slash) needs a row in `docs/decisions/README.md` whose **first cell starts with a link to it**: `| [text](NNNN-slug.md)`, optionally bold (`| **[text](NNNN-slug.md)**`). A leading `./` and an `#anchor` on the target are allowed.
- Every such first-cell link must point at a record that exists. Links that contain `://` or start with `..` are skipped; links in later cells are not read.
- Any other `.md` path under `docs/decisions/` except `README.md` fails.
- Messages: `docs/decisions/README.md does not list <file> (add its row to the table)`; `docs/decisions/README.md links <file>, which is not a record in docs/decisions/`; `docs/decisions/<file> is not named NNNN-slug.md (rename it or move it out)`.

### decision-rows (`tools/repo-checks/src/decision-rows.ts`)

- Reads only rows whose first cell links a target that starts with four digits and a hyphen (`| [text](NNNN-...)`, optionally bold; a `./` prefix is not matched here).
- Each such row's number must not repeat an earlier row's, and must not be lower than the highest number above it.
- Messages: `docs/decisions/README.md lists <NNNN> more than once`; `docs/decisions/README.md row <NNNN> comes after <NNNN> (keep the rows in number order)`.
- Two record files that share a number both need rows (index gate), and the two rows then repeat the number (rows gate), so a number collision always fails.

## Verify

```powershell
./geldar.ps1 pnpm check:repo
```

It prints `error: <message>` for each problem and exits 1, or passes. Only the two decision messages above concern this how-to; the run also covers line endings, control characters, IP literals and the other gates ([repo checks](../reference/repo-checks.md)). An untracked record with no row in the README table makes the run print `docs/decisions/README.md does not list <file> (add its row to the table)`, because untracked files are checked (line 66 above).

## Roll back

- **Before merge:** delete the file and its row.
- **After merge:** do not delete or rewrite the record. Write a new record that supersedes it (step 5). A rejected or withdrawn decision keeps its number.

## Conflicts recorded

1. **Status values.** The README template lists `Accepted | Superseded by NNNN`. The index at 03c1f5de also uses `Proposed`, `Decided` and statuses with a note in brackets (for example `Proposed (owner to accept)` on 0195, `Decided` on 0341, `Accepted (owner reset order, 2026-11-15; one-time)` on 0339). The README also says an open decision belongs in a ledger, not a record, yet `Proposed` records exist. Neither gate reads the status cell.
2. **Picking a number.** The README says sessions "may each pick numbers well apart". The Phase 1 conventions and the persona say the orchestrator reserves the numbers. Both coexist; this how-to follows the reservation rule because it is the later one and the Phase 0 retrospective records a collision under the older practice.

## Related

- Index: [decisions README](../decisions/README.md); by topic: [decisions by topic](../reference/decisions-by-topic.md).
- Reference: [repo checks](../reference/repo-checks.md) gates 11 and 12; [spec section map](../reference/spec-section-map.md).
- How-to: [merge queue](merge-queue.md) (how rows from parallel PRs land).
