# Bed stall diagnosis

Canonical bed (table +2,0,0; bed foot +2,0,2 facing south, head +2,0,3), 20 TPS, arena center 1248,200,800.

Cause: Body bug (a) in the pathfinder movement rules, not sleep.ts. The goal was GoalNear(1250,200,802, 1); the
A* path was [1249.5,800.5] -> [1250.5,801.5], a diagonal step that cuts the crafting-table corner (the library accepts a
diagonal when ONE side cell is free). The bot walked to x=1249.70 (flush with the table), then Paper rejected the pose
every tick: SRVPOS teleports (ids 5..17+) put it back at x~1249.55-1249.69, z~800.58-800.70, and it jittered
(800.70/800.72, onGround flipping) for 600 world ticks. path_reset "stuck" fired every ~4 s, path_update success len=1 each
time; isMoving stayed true. Same in all 3 runs (3/3 failures, each "no movement for 600 world ticks").

Fix: pathing.ts forbidCornerCutting wraps Movements.getMoveDiagonal and drops a diagonal unless both orthogonal side cells
are free at foot level. New path: [1249.5,801.5] -> [1250.5,801.5]. Stall watchdog (600 ticks, spec 5.2) untouched.

Results after the fix: bed 3/3 pass (2.4-2.8 s each, client and server asleep); bed-clear pass; bench-scenarios-b live
test pass; ./geldar.ps1 check passes. Revert check: removing the early return fails the "drops the diagonal" unit test.
After: tick query 20 TPS, list 0 players.
