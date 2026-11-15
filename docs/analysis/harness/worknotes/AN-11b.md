# AN-11b worknote: Body proficiency cache

Base `203d9af2` (origin/main). Branch `phase1/an-11b-body-cache` (the brief's name; the card's `codex/an-11b-body-cache` was not used).

## Files

- `golem/src/character/proficiency-cache.ts`: the AN-S0 stub body replaced. Exported signatures unchanged (`StateTransport`, `ProficiencyCache`, constructor options, all members).
- `golem/src/character/proficiency-cache.test.ts` (new): 17 cases on a fake transport with fake timers.

## Interpretations and deviations (each is a choice the card left open)

1. **Subjects are built locally.** `contract/src/index.ts` does not re-export the AN-02b helpers in `contract/src/subjects.ts`, and that index is outside the may-edit list. `stateSubject` builds `geldar.<shard>.state.<life>.proficiency` and `.level` and refuses a token that is not `[A-Za-z0-9_-]+`. The test asserts the exact strings.
2. **Accept rule.** A state or push is adopted when its version is above the cached version. The first adoption always wins, so a cold start at version 0 is not mistaken for an equal version. An equal version is ignored after adoption (the card's "equal version is ignored").
3. **Degraded.** `degraded` is true until a valid reply arrives. A valid reply that is stale or equal in version still clears it, because the responder answered. The log line is written once per degraded episode.
4. **Thresholds.** Each level is checked against `levelForXp(xp, thresholds)`, both in replies and in pushes. A mismatch is invalid, so the Body and the sink cannot disagree silently. A bad threshold list throws at construction.
5. **Sheet.** The reply's sheet goes through psyche's `normalizeSheet` (the orchestrator's ruling on the CharacterSheet and Score types). `hash` is the reply's `sheet_hash` when present, otherwise the SHA-256 of `canonicalSheetJson`. The reply's `sheet_hash` is not verified against the sheet, because AN-04a's canonical form is not checked here.
6. **Start.** The push subscription is made first, then one cycle of `attempts` requests. `start()` resolves after that cycle, so it can take up to `attempts * timeoutMs`. It never throws.
7. **Request body** is `{ life_id }` only. `have_version` is not sent.
8. **Logs** carry fixed phrases only. No sheet, level, xp or version value is logged.

## Open risk: forged push (decision 0280)

The card accepts a push on the version and validation rules alone. It does not make a push a re-request trigger. 0280 records that the body role can publish on `state.<life>.level` until the ACL follow-up lands. A forged push with a version above the real one would pin the cache: real replies at the lower version are then ignored. The ACL follow-up must land before the Body trusts the push path. This is a finding for the orchestrator, not a fix in this card.

## Revert-checks (card names)

1. Accept any version (`if (false && this.#adopted && version <= this.#version) return false;`): fails 3 tests: "a stale reply after a newer push is ignored" (expected 40 to be 50), "a level-up push during a reconnect refresh is kept over the older reply" (expected 40 to be 45), "an equal version is ignored, for a reply and for a push" (expected 3 to be 1).
2. Subscribe after the first request (`await this.#runCycle();` moved above the subscribe in `start()`): fails "a push during start is not lost" (expected +0 to be 5), and "a stale reply after a newer push is ignored".

The implementation was restored from a backup after each run (SHA-256 matched the committed file).

## Checks

- `golem/src/character/proficiency-cache`: 17 of 17 pass.
- `golem/src/character`: 4 files, 77 of 77 pass.
- `tsc --noEmit -p golem`: exit 0 (no emit).
- `biome check` on the two files: exit 0.
- `git diff --check`: exit 0.
- Line counts: implementation 264, test 341.
- `node tools/repo-checks/src/cli.ts` (the `check:repo` script): not run to a result. It fails before any check runs, with `ERR_MODULE_NOT_FOUND` for `fdir`, resolved through the shared pnpm store into another worktree (`an-05b`). This is environmental.
- `live: not run` (unit tests only).
