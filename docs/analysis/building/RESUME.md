# Building campaign resume

Refreshed 2026-11-22 at `origin/main` = `c05574a6`. State: plan written, nothing dispatched, nothing merged.

## Read in order
1. [README.md](README.md): purpose, exit criteria, decisions, packet table, risks, open questions.
2. [work-packets.md](work-packets.md): the parallelism section (shared files, Wave 0 scaffold, DAG, ownership table, conflict check), then the packet you dispatch.
3. Decisions [0420 to 0427](../../decisions/README.md).

## Owner rulings (2026-11-22, binding)
Break anything; nothing protected; no dig-safety refusals; next life inherits the seen map; survival materials, one block at a time; background plan lane; no caps (tick-budgeted); all 19 at once behind `body_actions.building`; seen-block map only, kept across death; skip changed cells; teach verbs, never nudge; Paper first, NeoForge gated.

## Next action
1. Owner answered Q1 to Q9 on 2026-11-22 (see README). Remaining: only the NeoForge human model (0387, 0390).
2. Create the integration branch `phase1/building` from `main`; dispatch Wave 0: BLD-S1 first, then S2, S3a, S3b, S3c, S4 together (width 5).
3. Then the Wave 1 fan-out (ten packets at once, incl. BLD-36, after `git merge-tree` checks).

## Rules to remember
- Only Wave 0 regenerates `contract/src/generated/*`; BLD-23 then BLD-26 are the only later contract edits.
- Only the orchestrator edits README; packets write `worknotes/BLD-NN.md`.
- Merges to main only at windows R1 to R3; tell geldar-93 first (colo-images restarts all 19 Bodies; `contract/**` counts).
- MANUAL: NATS role and bucket seed, the flag flip, the kit tag and upgrade PRs, any NeoForge jar.
- Never run `adam up` before live cases; no full local `./geldar.ps1 check`.

## In flight
None. Worktree for this plan: `../geldar-wt-building`, branch `docs/building-campaign` (not pushed).
