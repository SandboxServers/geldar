# 0336: A Body boxed in by reachability unsticks after 120 s

- Status: Decided (owner-side ruling via geldar-93, with the conditions below)
- Date: 2026-11-15
- Cites: 0196 (idle_stuck B1 and the backoff, cap and idle guards), 0330 (the 120 s own-placement clock), 0332 (two failed walks from one spot, `failedWalksAt`), 0333 (the high_ledge reason, the 120 s clock and the 12 an hour cap), 0164 (protection of other players' blocks, unchanged here).
- Why: the Tommy case (`ag_tommy_01`, sealed at (-313.7, 47, 322.3)). At 420 s idle the watch line read `enclosed` false, `canStepOff` true, `noSafeExit` false, so neither the enclosure rule, the ledge rule, the no-path rule (0332, own placement only) nor the high_ledge rule (0333) held. The planner's own region was a closed 7-cell pocket (`reach` 7, `reach_exit` false), and its walks all ended on stone inside it. The Body could not leave and no trigger saw it.

## Ruling

idle_stuck may run `unstick` for a Body that is boxed in by reachability (reason `boxed_in`) when every condition below holds:

1. **Boxed in.** The planner's reach region (`planMoves` expansion, cap 40 cells, `reach` from the watch probe) is under 40 cells, `reach_exit` is false, and the Body has been trying to move and failing from this spot: its last two goto outcomes ended `blocked` within one block (`failedWalksAt`, decision 0332). The Body has stood still (under 0.5 block) for the full 120 s, counted from the end of its last finished action.
2. **Only when idle with no progress.** It never fires while the Body is asleep or in a bed, resting after a sleep command, waiting by choice, or mid-action (a building, crafting, mining or pending `wait` action, or any Mind action running). These are the existing idle guards (`actionRunning`, `asleep`, `riding`, burrow) and the action-end clock reset. A sleeping Body in a small closed room never fires.
3. **Owned roofed shelter.** A Body standing on its own placement with a roof within three blocks (`roofWithin`) waits 300 s, not 120 s. The own-placement no-path rule of decision 0332 is a separate rule and still fires at 120 s when two walks failed; this record does not change it (see Findings).
4. **Dig guard.** Before the run starts, lava or water in the 3x3 column around the Body (one block below the feet to two above the head) refuses the run and logs the refusal; unread terrain refuses too. The unstick rungs (dig_up, stair_dig, dig_descend and the others) then run as before. Their own checks still apply: no digging into another player's build or any protected block (0164, unchanged), no drop into lava or water (the planner's rule, decision 0333).
5. **Bounded.** At most 6 boxed attempts an hour of world time, per life (`resetIdleStuck` clears the count). An attempt is counted when it starts, and a refused attempt counts too. A 5 minute cooldown separates attempts (owner ruling: at 10 minutes the cap could never bind). Each attempt writes one operator line (`idle_stuck (boxed_in) attempt N of 6 this hour`, or the refusal line). At the cap the gate writes one `cap reached` line (`event: idle_stuck_boxed`), and the trigger stays off until an hour window frees a slot. The reflex stops and logs; it does not loop.
6. **Watch line.** The `idle_stuck_watch` line keeps `reach`, `reach_exit`, `moves`, `enclosed`, `canStepOff`, `onOwnPlacement` and `noSafeExit`, and adds `boxed_in` (the region is closed and two walks failed from this spot).

## What is unchanged

- The enclosure rules (0196): enclosed by day fires, enclosed at night is a shelter.
- The 120 s own-placement clock (0330), the no-path rule (0332) and the high_ledge rule (0333) keep their clocks and triggers.
- The shared backoff, the 6 an hour unstick cap (0196) and the 12 an hour high_ledge cap (0333) apply to every boxed run too.
- Unstick's ownership rules (0164): other players' blocks stay protected and digging is not widened.
- The damage backoff (0196) and the hostile-nearby rule (not in place).
- No contract change, no schema change, no data change.

## Findings and limits

- The hour cap binds with the 5 minute cooldown: the sixth attempt lands at 25 minutes, and a seventh would land at 30 minutes, inside the hour, so the cap holds it. The literal reading (6 an hour per life) is what is built.
- The dig guard runs before each dig step of the unstick rungs (`setDigGuard`, checked in `dig`), and reads the terrain again at each step. Cave mouth (owner condition "never into a cave mouth", narrowed by the orchestrator): a cave mouth is an underground opening. A dig is refused when the cell beyond it in the dig direction is air with no sky access (sky light 0, or unknown, which counts as underground), or has such an air cell in the 3x3 plane across the dig, or when the cell beyond is air with air in the three cells below it (a drop of 3 blocks or more, at the surface too). Open surface ground with sky light is allowed: breaking out onto it is the purpose of the dig. The 0164 protection of other players' builds still applies through `protectedReason`.
- The dig guard is a check before the run, not before each dig step. A lava or water cell that appears during the run is not seen until the next attempt. Per-step checks would need changes inside the unstick rungs (`unstick-up.ts`, `unstick-descend.ts`, `unstick.ts`), which this record does not make.
- The owned-shelter 300 s clock applies to the boxed rule only. A roofed own block whose two walks failed still fires `no_path` at 120 s under decision 0332.
- Tests use a built 3x3 pocket (reach 9), not the server's 7-cell terrain. The real Tommy grid was not read.

## Rollback

Revert the commit that adds `idle-stuck-boxed.ts`, its test, the `boxed_in` wiring in `idle-stuck.ts`, and this record with its README row. No data, schema or contract changes, so a revert is the whole rollback.
