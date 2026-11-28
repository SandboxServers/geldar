# 0454. The experience record is a Geldar feature every harness gets

- Status: Accepted (owner ruling 2026-11-28 relayed via geldar-69)
- Date: 2026-11-27
- Spec: 5.15.4 (experience record) is amended by 0453. `docs/spec.md` is not touched.
- Source: `docs/analysis/sheet/memory-spine-design.md`, section 5, question Q2.
- Related: 0391 (memory spine), 0453, the world half and mind half split in design section 2.

## Decision

1. **The experience record is built on the Geldar side for every harness.** That includes harnesses an owner brings, not only the kit-run players.
2. **The mind half stays with the kit.** Owner-brought harnesses get the world half only (MS-G1 and MS-G2). How such a harness stores what it reads is its owner's concern.

## Why

An owner-brought mind has nothing else to carry facts from one session to the next. If the record existed only for kit-run players, the exit test ("a fact learned in session one is used in session three") could not be run for any other harness.

## Consequences

- MS-G1 and MS-G2 are built without a harness check.
- The record is read through the gateway, so the kit does not need to exist for it to work.
