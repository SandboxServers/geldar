# Sheet campaign assessment, 2026-11-18

Status: planning note, docs only. Written against `origin/main` = `a8063b0a` (2026-11-18). It replaces nothing: [RESUME.md](RESUME.md) (dated 2026-11-15) is still the campaign's resume file, and this note lists what in it is stale so the orchestrator can rewrite it. No decision number, SQL number or card status is changed here.

Tags as in the NeoForge notes: **VERIFIED** = read in this repo at `a8063b0a` (path or merge commit given). **UNVERIFIED** = not checked here; needs an owner answer, a node check or a source read.

## 1. Where the campaign stands

### 1.1 Merged on main (W0 to W2 closed in code)

Every card of W0, W1 and W2 has merged, inactive by default (VERIFIED by merge commits on `origin/main`):

| Wave | Cards | Evidence |
|---|---|---|
| W0 contract and psyche | AN-02a (#372), AN-02b (#386), AN-03a/b (#401, #409), AN-03c temperament bank, inactive (#411), GX-02 tag `psyche-v1.0.0` (#413) | RESUME "Done"; tag `psyche-v1.0.0` exists locally |
| W0 SQL and ACL | SQL 0050 to 0052 (#395, #403, #455), ACL (#394), decisions 0280 to 0282 | `sql/0050_character_sheet_xp.sql` to `sql/0052_character_erase_comments.sql`; `docs/decisions/0280-*`, `0281-*`, `0282-*` |
| W1 | AN-05 (#439), AN-05b (#467), AN-06a (#426), AN-06b (#431), AN-07 (#453), AN-S0 (#456) | RESUME "Done" |
| W2 | AN-08a (#458), AN-08b (#476), AN-09a (#473), AN-09b (#468), AN-09c (#509), AN-10a (#472), AN-10b (#478), AN-11a (#480, merge `f11f2617`), AN-11b (#471), AN-11c (#487, merge `b95cb758`), AN-12a (#493, merge `dc6fa13e`), AN-12b (#492, merge `ed355e8f`) | merge commits on main |
| World extras | GX-01a/b/c, GX-04a (#347), GX-05a (#452), GX-06 (#504), GX-08 (#526, merge `9533d731`) | merge commits on main |
| Housekeeping | nats-auth test split (#534, merge `5a64dd67`), step-0 test-shard driver (#519) | `tools/repo-checks/src/nats-auth.test.ts` is 154 lines |
| Cards | W3-W5 (#457), W6-W8 (#463), W9-W12 (#464) | `docs/analysis/harness/work-packets-sheet-*.md` |

What W2 gives, in one line: a Body that can hold a per-life sheet, roll threat responses, publish XP evidence (`action`, `intent`, `chunk_visited`, all Body-produced, `eventsink/src/xp/awards.ts`), and read its proficiency levels from the sink's state service, all switched off.

### 1.2 Not started

- W3, W4, W6 (kit cards HC-18 to HC-31; repo `geldar-scriptorium`). Kit status was not checked for this note (UNVERIFIED: RESUME says HC-18 merged on `scriptorium/hw0` as `4ab4493`).
- W5 (AN-24 to AN-28b), W7 (AN-39 to AN-45), W8 (AN-46 to AN-51b, AN-50), W9 to W12 (S9-00 to S12-07). No branch, no worktree, no decision record 0283 to 0289 exists (`docs/decisions/` has none). SQL 0053 to 0059 are unused (`sql/` has 0050 to 0052, then 0060 and up).
- `psyche` is at version 1.1.0 (`psyche/package.json`); only the tag `psyche-v1.0.0` exists locally. The `psyche-v1.1.0` tag still waits for owner approval (RESUME; remote tags UNVERIFIED).

### 1.3 The held-live ruling (unchanged)

The owner ruling of 2026-11-15 stands: every sheet feature stays held on the live server until the whole campaign is complete. Each feature is first validated by agent runs on a test shard, with evidence of intended use. Inert code still merges. OD-10 (adoption of existing agents) waits. Nothing in the repo since then changes this ruling.

Consequence for planning: the remaining nine waves can merge as inert code, but no wave can close with live evidence until the test-shard plan (draft 2, about $20 total) is committed and its runs are scheduled. That plan is **not in the repo** (`docs/analysis/sheet/` holds only `RESUME.md`); RESUME says it exists only in a session scratchpad. If that scratchpad is gone, the plan must be rewritten.

## 2. Stale items in RESUME.md (2026-11-15)

| RESUME line | What the repo shows now | Action for the orchestrator |
|---|---|---|
| "AN-11a not merged: PR #480 open" | Merged (`f11f2617`) | Move to Done |
| Next 1: "Contract card: drop sheet and sheet_hash from the proficiency state reply" | Done by AN-11c (#487). `contract/schemas/proficiency-state.schema.json` now refuses `sheet` and `sheet_hash` | Move to Done. Note: decision 0280 item 3 still describes `sheet?` and `sheet_hash?` on the reply; it is Accepted, so it is not edited, but a reader needs a pointer (a new record or a ledger note) |
| Next 2: "AN-12: integration, default off; needs the NATS ACL step" | AN-12a (#493) and AN-12b (#492) merged | Move to Done; the "Kept inert" list should say whether the batched ACL step (batch A) is complete |
| Next 4: "Split nats-auth.test.ts (544 lines)" | Done (#534); the file is 154 lines | Move to Done |
| Open: "GX-08 must land before GELDAR_INSTINCT is enabled" | GX-08 merged (#526) | Move to Done; the instinct key is still unset (UNVERIFIED) |
| Next 3: "Recapture AN-09a chunk fixtures from AN-09b's real builder" | Not checked | Keep, unless the AN-09a worknote says done |
| Next 5: "Re-ask the owner for the W3-W12 coding order when W2 closes" | W2 has closed | Do it now (section 4, item 1) |
| Test-shard plan "exists only in the session scratchpad" | Still absent from the repo | Commit it under `docs/analysis/sheet/` or rewrite it |
| Header: "Updated 2026-11-15" | Three days and some 270 PR numbers later (#487 to #760) | Rewrite RESUME at this boundary (campaign-packet skill section 5) |

Stale or inconsistent items inside the card files (they are not edited by this note; each needs a card correction before dispatch):

1. **Worknote path.** W3-W5 rule R3 says `docs/analysis/character-sheet/worknotes/`; W6-W12 say `docs/analysis/harness/worknotes/`. The worknotes that exist are under `docs/analysis/harness/worknotes/` (AN-02a to AN-12b, GX-*). Use that one.
2. **AN-27a paths.** The card names `plugin/.../blockowner/NatsBlockOwnerLink.java` as a plugin file. Since the P2 core split it is `plugin/core-common/src/main/java/dev/geldar/core/blockowner/NatsBlockOwnerLink.java`, and `OwnerCache.java` is in core-common too. `BlockChangeListener.java` and `BlockOwnerSetup.java` stay in `plugin/core`.
3. **File sizes the cards quote.** `golem/src/adam/adam-body.ts` is 413 lines (cards say 293 and 311); `contract/src/index.ts` is 557 lines (cards say 534 and 535). Both are still under the 700 hard cap, so the cards' "one export line" rules still hold, but AN-28b's "keep under 500" for `adam-body.ts` has about 87 lines of room.
4. **The ledger** (`docs/analysis/harness/ledger.md`) lists 104 cards, all with status `Writing`, and none of W5 to W12's AN or S cards. It says "regenerate after any card edit"; it was not regenerated after the W3-W12 card files merged. Regenerate it, with merged cards marked Done.
5. **The 2026-11-15 card corrections** (`docs/analysis/harness/worknotes/cards-w3-w12-corrections.md`) are applied in the card files; nothing to do.

## 3. Open owner decisions

Carried from RESUME and the card files (all parked; geldar-93 holds the list):

- Temperament delivery route and wording (OD-A, HC-25); sanity-veto wording (OD-B, HC-23a); observation sentences (OD-E, AN-24 and AN-28a); program summaries and `INTENT_WHY` (AN-44, AN-45); W8 sentences (AN-46); social prose bank (HC-29).
- D-CS-05 row (aggression 5, unarmed, `rolls:false`); D-CS-04 XP matrix rows, the crop list, the torchflower and pitcher gap; D-CS-06 (visible causal actor) for all of W5 and W8; D-CS-14 (program boundaries); D-CS-15 (exchange window).
- OD-C: where the kit gets proficiency levels (round one: all zero, degraded).
- OD-D: `animus/src/link` exception for AN-28a, or GX-04 first. GX-04a has merged and the live files are under `player-core/` (W6-W8 ground rules), so OD-D may be moot for AN-28a; the W3-W5 card still names the `animus/` paths. Needs a card correction, not an owner answer, if `player-core/src/link/mind-event.ts` is the live file (UNVERIFIED for AN-28a's exact rows).
- Moral hook (OD-1 to OD-4, decision 0283), lineage (OD-5 to OD-7), drift (OD-8, OD-9), adoption (OD-10), cohort, spend and success bars (OD-11), erasure of dead lives (OD-12, recorded in 0282).
- Per-life NATS ACL scoping.

New, from the NeoForge side (detail in [neoforge-delta.md](neoforge-delta.md) section 5):

- OD-NF-1 to OD-NF-8: human actors in provenance on the human-directed NeoForge shard (decision 0387 is Proposed), human attackers in `observedActor`, container-take detection on NeoForge, kill credit, proximity chat on NeoForge, human owners in the NeoForge block-owner log, whether the sheet runs on the NeoForge shard at all, and how progression (0385, Proposed) relates to proficiency (0280).

## 4. What is next

In order. Items 1 to 4 are orchestrator or owner work; nothing can be dispatched to a coder before item 3.

1. **Owner: the W3-W12 coding order** (RESUME Next 5, now due). The default the cards imply: W5 (world) and W3-W4 (kit) in parallel, then W6 and W7, then W8, then W9 to W12. Add one question: does the campaign include the NeoForge shard (OD-NF-7)? If not, the NeoForge twin cards stay parked and nothing else changes.
2. **Rewrite RESUME.md** from section 2 above, and regenerate the ledger.
3. **Correct the Paper W5 and W8 cards before dispatch**, so the NeoForge twins can reuse code instead of copying it: amendments A1 to A5 in [neoforge-delta.md](neoforge-delta.md) section 3 (shared provenance sink, provenance JSON builders, prior-owner read, encounter tracker and hostile list in `plugin/core-common`, and the human rule for `observedActor`). These are edits to `work-packets-sheet-w3-w5.md` and `work-packets-sheet-w6-w8.md`, made by the orchestrator, not by this note.
4. **Commit the test-shard plan** (draft 2) under `docs/analysis/sheet/`, or record that it must be rewritten.
5. **W5 contract slot**: AN-24 is the only W5 contract card and the unblocker for every other W5 card. Ask geldar-3b for the serial regeneration slot.
6. **Kit W3**: HC-19 onward, with the scriptorium orchestrator (message before shared files; RESUME "Kit handoff").
7. **NeoForge**: the twin cards in [../harness/work-packets-sheet-neoforge.md](../harness/work-packets-sheet-neoforge.md) are all BlockedDependency or BlockedDecision. Their prerequisites outside this campaign are P3-LIVE (the scratch proof of the NeoForge export, P3-6) and P4 (the NeoForge block-owner log, not designed yet), plus the NeoForge Body role (OD-NF-7). Hand the P4 requirements in [neoforge-delta.md](neoforge-delta.md) section 4 to the NeoForge campaign before P4 is designed.

## 5. A correction to the brief this note was written from

The brief for this note said that NeoForge P3 (event export) is on hold. The repo disagrees: P3-1 to P3-4 have merged as code. `neoforge/` builds a mod that consumes `plugin/core-common` as a composite build, exports `damage`, `death`, `sleep` and `server_tps` (`neoforge/src/main/java/dev/geldar/neoforge/ExportListeners.java`, commits `11c70ca7`, `32b88e4d`, 2026-11-17), never exports a human player name (`b20fa32d`), guards that chat is not exported (`5b0b7f62`, `d642ea92`, 2026-11-18), and receives maintenance notices (`dabceab0`). Its README says the scratch-stack proof is `live: pending`. P3-5 (GameTests) and P3-6 (scratch probe) are not in the repo. `docs/analysis/neoforge/RESUME.md` (2026-11-17) still says "Next: P3", so it is stale too. P4 and P6 to P8 are on hold as the brief said.

The twin cards therefore name **P3-LIVE** (P3-6 merged and its scratch run passed) as the P3 prerequisite, not "P3 merges".
