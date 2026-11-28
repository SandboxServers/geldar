# AN-45c worknote: observed actor needs a basis

## What changed

- The observed actor is named only when the payload gives a basis (`seen`, `spoke` or `signed`).
  Without a basis the sentence says "Someone", and the player line drops the actor (decisions 0343, 0391, 0450).
- A named actor must also be a Minecraft name (3 to 16 characters of `A-Za-z0-9_`), have no digit,
  have no life-id shape (`ag_<handle>_<digits>`) and carry no marker word.
- `contract/src/observation.ts` owns the rule (`observedActorName`, `observationSentence`).
  `threshold/mcp/src/events/handlers/observation.ts` uses the same rule for the presented line.
- `threshold/mcp/src/events/leakage.test.ts` is rewritten for the 0450 rule: a valid-basis clean-name
  fight or take line names the actor; every other case says "Someone".

## Checks

- `contract/test/observation.test.ts` already covers the shape cases ('Zack Two', 'Ab', a 17-character
  name, 'Zack\nx' with basis `seen`) and `actor: null`, so no contract test was added.
- Leakage gate: `threshold/mcp/src/events/leakage.test.ts` (18 tests) passes on the fix.
- Formatting, `check:repo` and typecheck results are in the report for this packet.

## Revert-checks

Each mutation was made on the committed fix, run, then reverted by copying a backup over the file.
`git diff --stat` was empty afterwards.

1. Digit and life-id guard (earlier session): fails as expected.
2. Handler `threshold/mcp/src/events/handlers/observation.ts`: the presented line's actor was set with
   `visibleActorName(p.actor?.name)`, which ignores the basis. `leakage.test.ts` fails. The failure is the
   life-id actor `ag_zack_01` reaching the presented line, not the basis assertion itself.
3. Contract `contract/src/observation.ts`: the `ACTOR_NAME.test(name)` check was removed from the named-actor
   guard. `observation.test.ts` fails: 'Zack Two' renders as "Zack Two broke your chest." instead of "Someone".

## Deviations

- Edits outside the card's list: three golem provenance tests and `hostile-types.test.ts` were changed.
  They are in the earlier commits on this branch.
- This packet supersedes PR #955.
- The serial slot is before AN-51c, and AN-51c is merged on top of this packet.

## Unverified

- Full test suites were not run.
- The live lane was not run.
