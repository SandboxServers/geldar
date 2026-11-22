# BLD-15 worknotes: TPS throttle for the plan lane

- throttle.ts: throttleWait(options) waits the gap before each block operation. Gap 4 ticks at TPS >= 18, 8 ticks from 12 up to 18, paused below 12 (polls every 20 ticks, reports onPause once, resumes when TPS recovers). Unknown TPS runs at full speed.
- Waits are scaled by timeScale, as in break.ts and other actions.
- No cell cap: a test runs 100,000 cells through the throttle with a fake clock.
- index.test.ts: throttleWait removed from the STUBS list (it is implemented now).
- Known pre-existing failure, not touched here: index.test.ts lists surveyBox as a stub, but seen/survey.ts (BLD-20) implements it, so that case fails on the base commit too.
- Packet branch name is phase1/bld-15-tps-throttle; this worktree uses the brief's phase1/bld-15-throttle.
