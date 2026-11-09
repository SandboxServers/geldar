# 0037. Chest deposits and withdrawals are an explicit, server-confirmed click sequence

- Status: Accepted (made autonomously overnight; owner review requested, see `docs/analysis/phase0/overnight-decisions.md`)
- Date: 2026-11-09
- Spec: section 5.2 (Body API: open, deposit, withdraw); decision 0022 (Mineflayer 4.39.0 stack and the stop-and-report rule); decision 0032 (the same class of library gap for crafting); packet P0-09b

## Decision

`deposit` and `withdraw` do not call Mineflayer's `bot.deposit` / `bot.withdraw` (its `transfer`). `golem/src/actions/container-transfer.ts` performs them as an explicit sequence of window clicks: it predicts the slots and the cursor after each click, sends the click with the window's own `stateId`, then sends a sync click (`stateId -1`) and waits for the server's `window_items` answer before the next click. If the window differs from the prediction, or on a timeout, an abort or a closed window, it stops, puts the cursor back and reports an error with the honest moved count. It never reports success on a mismatch. Item components are not modelled: the cursor stack is sent in the hashed form with empty components and the server stays authoritative.

## Why

On the live Paper 26.1.2 shard, Mineflayer's chest transfer loses items: it does not wait for the server to confirm chest clicks (one shared `stateId` for every window, and `waitForWindowUpdate` returns at once), so its follow-up clicks run on a stale client view. Observed in about half of isolated runs: the whole stack leaves the chest onto the cursor, nothing reaches the bot, and closing the window loses the items. Lost items would corrupt Adam's inventory, so this had to be fixed in our own code; decision 0022 forbids patching the library.

## Consequences

- A deposit or withdraw costs one round trip per click; a transfer is bounded at 64 items per action by the contract.
- Component-bearing stacks (a damaged tool) work because the server computes each click; `moved` counts by item id.
- When Mineflayer confirms chest clicks per window, this can go back to the library calls.
- Live evidence: `container.live` 9 of 9 green, three full live lane runs green; the chest is read back through RCON (`chestItems` reads slot by slot when the server folds the reply).
