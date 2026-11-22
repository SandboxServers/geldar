# ACT-3: restart resumes only programs the Body registers

Branch `phase1/act-3`, from `origin/main` d00b15fd. Base for the squash: d00b15fd.

## What the code checks

- The refusal is in `golem/src/body/restart.ts` (`recover`): `body.runtime.programs.names().includes(entry.program)`. It uses the Body's own registry from `createProgramRegistry()` (`golem/src/body/programs/index.ts`), not the player-core `PHASE0_PROGRAMS` list (`player-core/src/validate/bounds.ts`). Both lists hold `explore`, `farm` and `patrol` after #864.
- Registered: the ten programs of `createProgramRegistry()`, plus `trade_wait` (an `UnsupportedProgram`, which refuses at run time).
- Before this change the refusal was silent: the Body went idle with `unknown_program` and nothing in the log said which program was refused.

## Done

- `golem/src/body/restart.ts`: an unregistered checkpoint program now logs one line (`restart: the checkpoint's program "<name>" is not registered; the Body starts idle`) before the intent is closed and the entry discarded. Nothing else changes.
- `golem/src/body/restart-programs.test.ts`: resume for `explore`, `farm` and `patrol` (the resume tests use scripted stand-ins under those names, see Open); the real registry names all three; an unknown program is refused with the log line and a `no_plan` wake after 45 s, no throw; a program removed from the registry is refused the same way and its intent is closed as `interrupted`.

## Revert-checks

Run on the committed fix (WIP commit), one mutation at a time, then restored from a backup copy:

- A, log line discarded (`(log ?? ...)(` replaced by `((_line: string) => undefined)(`): `restart-programs.test.ts` 1 failed, 5 passed. `× an unknown program is refused: idle, reason logged, no_plan wake after the wait, no throw`, `AssertionError: expected false to be true` (the log assertion).
- B, registry guard dropped (`if (!body.runtime.programs.names()...)` replaced by `if (false) {`): 2 failed, 4 passed. Both `unknown program` tests fail, the refusal is no longer reached.

## Open

- The three resume tests use scripted stand-ins, not the real programs: a real `explore`, `farm` or `patrol` checkpoint has a strict shape (`checkpointReader`), and building a valid one is outside this packet. Only the registry membership of the real programs is checked.
- `trade_wait` is registered (as `UnsupportedProgram`) but not in `PHASE0_PROGRAMS`: a checkpoint naming it would resume and then refuse at run time, not at restart. No code writes such a checkpoint (the validator refuses the intent), so it is not changed here.
- Other idle reasons (`no_checkpoint`, `expired`, ...) are still not logged by `recover`; only `unknown_program` is, as the brief asked.
