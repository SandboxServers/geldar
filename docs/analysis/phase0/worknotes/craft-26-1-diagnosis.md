# Craft on 26.1: diagnosis

Cause: Mineflayer 4.39.0 keeps ONE `stateId` for every window and sends it with every `window_click`. In a table (`windowId 1`) the value comes from window-0 packets, so the server treats the click as stale and answers with a full resync that overwrites the client's optimistic model. The library's click script then runs on a wrong model and the grid is never filled correctly.

## Method

Throwaway probe at `...\scratchpad\probe.cjs` (outside the repo). It joined as `ProbeCraft` on 127.0.0.1:25565 (offline, 26.1, whitelist add/remove through RCON), logged inbound and outbound window packets with timings, and cleaned up (clear, table removed, `tick rate 20`, whitelist remove). Stack not touched.

## Evidence

1. 2x2 craft (`oak_planks` from a log, no table): works. The grid click and the result take-out both carry a valid view and the server returns 4 planks.
2. Table craft of `white_bed` (3 wool, 3 oak planks, table at +2): fails every time (4 runs). Traces, `st` = the stateId sent:
   - `open_window` id 1, then `window_items win1 state 1`. The window-1 counter starts at 1.
   - First click (pick up wool): `window_click w1 st8 slot37`. 8 is the window-0 counter; window 0 keeps sending `set_slot windowId 0 slot 45` (stateId 8, 9, 10, ...) and Mineflayer's single listener (`inventory.js` lines 33-38: `stateId = packet.stateId` for every `window_items` and `set_slot`) takes those values.
   - The vanilla server always executes the click, but with a stateId mismatch it then calls `broadcastFullState`. Each click is answered by a full `window_items` snapshot, taken before the next client click has been applied (`win1 state 2 38:36x3 cursor 213x3`, slot 1 empty).
   - That snapshot replaces the client model. Next click: `slot2 btn1 ... cursor 213x2` (should be 1 wool left, model says 2). The model ends holding one phantom wool. At the planks step Mineflayer sees the wrong cursor type, sends an extra `slot38` click, and the planks land in slot 38 (final server state: `4:36x1 38:36x2`, slots 1-3 wool, slots 5-6 empty).
   - Result slot never shows a bed. On close the grid returns. Matches the symptom (server keeps ingredients).
3. Why 2x2 works: window 0 has no second counter, so the stateId is always right. Why the table fails: every table click after the window opens uses a stale or foreign stateId. `wooden_pickaxe` (planks, then sticks, so one cursor change) is intermittent because the damage depends on whether a resync snapshot lands between two of the library's back-to-back clicks. `white_bed` needs the cursor to carry wool across three right-clicks and then switch to planks, so the drift is always exposed.
4. Not the cause: the result slot is not clicked early, the recipe shape and the slots (1-3 wool, 4-6 planks, 3-wide grid) are right, and the hashed-slot encoding is accepted (the server reports no hash error; it processed every click in order).

## Is it a Mineflayer 26.1 gap?

Yes. A global `stateId` is wrong for any non-inventory window. It is invisible on older servers, where a mismatch only dropped the click, and it breaks a multi-click script on 26.1 where the server resyncs. Window 0's extra `set_slot` traffic on this Paper build makes it deterministic. Upstream fix: track stateId per windowId. We do not patch `node_modules`.

## Workaround that stays in `golem/src`

Do not use `bot.craft` for table recipes. Use the server-side place-recipe path (verified):

1. `bot.activateBlock(table)`, wait `windowOpen`. Record the window id.
2. Collect recipe displays: listen to `recipe_book_add` (entries[].recipe.displayId and display.data.result.data.itemId and display.type) from the moment of join. Choose the entry whose result is the item and whose type is `crafting_shaped` or `crafting_shapeless` and fits (a result can have several displays: for `white_bed` id 1454 is shaped, id 499 is the dye recolour).
3. `bot._client.write('craft_recipe_request', { windowId, recipeId: displayId, makeAll: false })`.
4. Wait for `set_slot { windowId, slot: 0 }` with a non-empty item (arrived 4 ms later in the probe).
5. Send `window_click { windowId, stateId: <last stateId of THIS window>, slot: 0, mouseButton: 0, mode: 1, changedSlots: [], cursorItem: <empty> }` (shift-click the result). Result: `inv white_bedx1`, and the server resyncs the grid and inventory.
6. Close the window; the existing `SETTLE_TICKS` wait and `heldCount` check stay as they are.

Probe result: `white_bed` crafted (inventory `white_bedx1`) in about 330 ms after the window opened.

Caveats:
- The recipe must be in the player's recipe book. The probe forced that with `recipe take/give`. Natural unlock follows the ingredients being held; for a fresh bot use `recipe give` in the live test setup, and in production fall back to a failed outcome (`missing_materials` or `not_possible`) when no display is known. Needs a decision before shipping.
- Mineflayer's recipe data (`bot.recipesFor`) stays the source of "can I craft it"; the display id is only the server handle. The window display ids come from the live book, not minecraft-data.
- Alternative, no recipe book: own click loop with a stateId taken only from packets with the table's `windowId`, awaiting each ack before the next click (about the same code as the library, but with a correct stateId and a rebuilt model from each `window_items`). More code and more timing risk; second choice.

## Effort

About 0.5 to 1 day: a small `place-recipe.ts` in `golem/src/actions` (display collector, request, wait, shift-click, stateId tracker per window), `craft.ts` using it for table recipes, unit tests with a fake client, and the live `craft.live.test.ts` cases (add `recipe give`). 2x2 recipes can keep `bot.craft`. Upstream issue/PR to Mineflayer (per-window stateId) is optional.
