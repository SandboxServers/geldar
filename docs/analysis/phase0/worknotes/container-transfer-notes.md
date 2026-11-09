# Container transfer notes (P0-09b chest findings, decision 0037)

## The symptom

`container.live` failed about 2 runs in 4: "withdraw 4 leaves 6" read an empty chest (`{}`) and the
action reported `not_possible` ("inventory full", moved 0). Isolated runs showed the bot inventory
empty, the cursor holding all 10 cobblestone and the server chest empty: the whole stack left the chest
and none reached the bot.

## The cause (Mineflayer 4.39.0, `lib/plugins/inventory.js`)

- `clickWindow` writes `window_click` with one module-level `stateId` shared by every window.
- A chest click is never awaited (`waitForWindowUpdate` resolves at once when the state id was used), so
  the put-back runs on a stale client view and the item is lost when the window closes.
- A click the server accepts gets no reply; only a stale or impossible `stateId` is answered with
  `window_items`. Waiting for a per-click packet would hang.
- `syncWindow` (stateId -1, slot -999, mode 5) is the only barrier: the server always answers it with
  `window_items` for that window.

## The fix (`golem/src/actions/container-transfer.ts`)

A click sequence: for each click, write `window_click` with the window's own `stateId` and a predicted
`changedSlots` and `cursorItem` (HashedSlot, minecraft-data 3.117.0 `pc/26.1`), then the sync click, then
wait for `window_items` (bounded, scaled by `timeScale`, aborted by the signal). The window after the
barrier must equal the model of slots and cursor, else the transfer stops with `internal` and puts the
cursor back. Moving N of a stack of M: left-click the source, place into destinations, left-click the
source to return the rest. The container action keeps its pre-checks and counts the result from the
settled inventory.

## Results

- `container.live` 12/12 green; the full live lane twice green (9 files, 49 tests).
- Reverts checked: no per-click barrier, no cursor restore and no mismatch check each fail a unit test.

## Test-side findings (fix-5)

- The contract caps `count` at 64 per action, so a 100-item case became 64 + 36.
- The server folds the `data get block ... Items` reply to `...` when a stack has components or there
  are several stacks, so `parseItems` read nothing. `chestItems` in `golem/src/test-control.ts` now reads
  the 27 slots one by one when the reply is folded, and `parseItems` throws on a truncated reply.
