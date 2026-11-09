# Overnight decisions (orchestrator, owner asleep)

The owner asked the orchestrator to work autonomously overnight, to note every decision and the answer chosen, and not to compromise quality or security. Newest last. Owner: review and overrule any of these; a decision here that matters long-term also has a record in `docs/decisions/`.

| # | When | Decision | Chosen | Why |
|---|---|---|---|---|
| 2 | 2026-11-09 | Mineflayer 4.39.0 `bot.craft` breaks table crafts on 26.1 (global stateId) | Work around it inside `golem/src/actions/craft-table.ts` (craft_recipe_request + shift-click with the window's own stateId); no library patch, no version change | Packet rule forbids patching the library; the workaround is our own code, tested live (46/46) |
| 3 | 2026-11-09 | Batch review rounds | Round 2 running on the combined diff; up to 5 rounds per owner ruling; live probe module and review item F8 deferred | Owner asked for fewer, fuller reviews |
| 4 | 2026-11-09 | Table-craft recipe unlock policy (review H3): a bot without the recipe in its recipe book | Return `failed('not_possible')` with `detail.unlocked: false` (not `missing_materials`), and add a live case with ingredients only (no `recipe give`) to prove vanilla unlocks on pickup; if it does not, report as a finding | A wrong reason would send the Mind to gather materials it holds; real play must work without RCON |
| 5 | 2026-11-09 | Live probe module and review item F8 | Deferred; duplication of local live helpers is allowed by the conventions; F8 moot for a merge-based batch | Reviewer judged acceptable |
| 1 | 2026-11-09 | Scriptorium Wave 3 request (mock Geldar MCP world in this repo) | Owner then said "Build their wave 3 as requested": I build SC-30 to SC-33 on a separate integration branch `scriptorium/wave3` off `main`, once the packets arrive from the Scriptorium orchestrator | Owner authorised it; separate branch keeps Phase 0 PRs reviewable |
