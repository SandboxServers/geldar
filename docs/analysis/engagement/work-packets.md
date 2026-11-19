# Engagement work packets

## Dispatch rules

- One `packet-coder` per packet, in its own worktree from `origin/main` (one-packet wave: no integration branch).
- Rules inlined here, since the coder does not read CLAUDE.md:
  - A behaviour change needs a test that fails when the change is reverted. Check that it does.
  - Files: soft cap 500 lines, hard cap 700.
  - LF line endings.
  - Never edit generated code: change `contract/schemas/`, then run `./geldar.ps1 pnpm --filter @geldar/contract generate` and commit the output.
  - Refusal and fact texts are fixed facts. They name no other verb, no harness word and not "the body" (decisions 0058, 0068, 0154).
- No live lane, no Docker, no `adam up`. Live checks are U0-02 and belong to the orchestrator.

## Wave U0: unblock the gate

| Packet | Unblocks | Parallel |
|---|---|---|
| U0-00 | Nothing in code. Confirms the shapes agents send, and may add a follow-up. | With U0-01 |
| U0-01 | U0-02 | With U0-00 |
| U0-02 | Closes U0 | After U0-01 is deployed |

### U0-00: what `use` shapes agents sent for weapons (done, 2026-11-18)

Done by the orchestrator session. Results and queries: `docs/analysis/engagement/worknotes/U0-00.md`.

- The route actually used: `docker exec` into `geldar-ch` as ClickHouse `default` with `readonly=1`. This was a one-off owner ruling (D-EN-02), because the `geldar_reader` password is root-only on the node. It is not a standing route; D-EN-03 is.
- The scope actually used: MCP `mcp.tool_call` span arguments. Shape counts came from `act`; phrase counts came over `act`, `journal` and `say` arguments, and only counts were published. The events table and chat were not read.
- The planned step 3 (hold, equip or wield text) did not produce a usable count. The note marks it unmeasured.

### U0-01: `use` with an item and no target holds the item

Implements [decision 0389](../../decisions/0389-use-with-an-item-and-no-target-holds-it.md). Branch `engagement/u0-use-hold`, in its own worktree.

**Merging deploys.** `golem/**` and `contract/**` match the colo-images filter. A merge to `main` builds new images, and colo-deploy restarts the shared services and then each live Body in turn.

**1. `golem/src/actions/use.ts`**
- Add `notHeld: 'the item did not go into the hand'` to `USE_MESSAGE`.
- In `use()`, replace the line `if (action.at === undefined) return failed('not_possible', USE_MESSAGE.noTarget);` with:
  ```ts
  if (action.at === undefined) {
    if (action.item === undefined) return failed('not_possible', USE_MESSAGE.noTarget);
    return hold(ctx, action.item);
  }
  ```
- Add `hold`, with a doc comment that cites 0389:
  ```ts
  /** Puts `item` in the main hand and reads the hand back. Clicks nothing (decision 0389). */
  async function hold(ctx: ActionContext, item: string): Promise<ActionOutcome> {
    const { bot, signal } = ctx;
    const { stack, missing } = itemToHold(bot, item);
    if (missing) return failed('missing_materials', USE_MESSAGE.noItem);
    if (stack) {
      try { await bot.equip(stack, 'hand'); } catch { return failed('not_possible', USE_MESSAGE.notHeld); }
      if (signal.aborted) return cancelled();
    }
    if (bot.heldItem?.name !== item) return failed('not_possible', USE_MESSAGE.notHeld);
    return completed({ held: item, fact: `${item} in hand` });
  }
  ```
- In the `use()` doc comment, add one sentence: "With an item and no target, the item is put in hand (decision 0389)."
- Leave every shape with `at` or `entity` unchanged.

**2. `golem/src/actions/use.test.ts`.** The fake bot already has `held` and `items`. Make sure its `equip` sets `held`; add that if it is missing.
- Keep the existing test "refuses a use with neither a block position nor an entity" (`use(bot, {})`, which has no item). Rename it "…nor an item".
- Add a `describe('use: an item and no target puts the item in hand (0389)')` with:
  - `{ item: 'wooden_sword' }` with the sword in the inventory and an empty hand: the result is `completed({ held: 'wooden_sword', fact: 'wooden_sword in hand' })`, the hand holds `wooden_sword`, and `clicks` is empty.
  - The sword already in hand: the same ok result, and `equip` is not called.
  - The sword not carried: `failed('missing_materials', USE_MESSAGE.noItem)`, and the hand is unchanged.
  - `equip` resolves but the hand still holds something else: `failed('not_possible', USE_MESSAGE.notHeld)`.
  - `equip` throws: `failed('not_possible', USE_MESSAGE.notHeld)`.
  - The shard flag is off (`useHandler(false)`) with `{ item: 'wooden_sword' }`: refused with `USE_MESSAGE.notYet`, and the hand is unchanged.
  - `{ item: 'wooden_sword', at: TARGET }` on a plain block (for example `stone`): still `failed('not_possible', USE_MESSAGE.notUsable)`, and the hand is unchanged.
- Revert check: with the `use.ts` change undone, the first test fails because the result is `noTarget`.

**3. `golem/src/body/executor-outcome.ts`.** In `okFactText`, send the `detail.fact` of an ok `use` as well: `if (verb === 'till' || verb === 'place' || verb === 'use') return farmlandFactText(result);`. Rename `farmlandFactText` to `detailFactText` and update its doc comment ("the fact an ok till, planting or use carries in its `detail.fact`…"), and update the `okFactText` doc comment.

**4. `golem/src/body/executor-outcome-fact.test.ts`.** Add "carries the held fact as detail_text on an ok use": `actionOutcomeOf('use', 0, okReport({ held: 'wooden_sword', fact: 'wooden_sword in hand' }))` matches `{ ok: true, detail_text: 'wooden_sword in hand' }`. Add a second case: an ok door `use` without a fact has no `detail_text`. Revert check: without the `verb === 'use'` clause, the first case has no `detail_text`.

**5. `contract/schemas/action-outcome-event.schema.json`.** In the description at line 48, change "till and place send their plain fact when the Body has one" to "till, place and use send their plain fact when the Body has one (use with an item and no target sends '<item> in hand')". Run the contract generate script and commit the generated output.

**Checks, in order:** `./geldar.ps1 pnpm --filter @geldar/golem test -- use executor-outcome`, `./geldar.ps1 pnpm --filter @geldar/contract check:generated`, then `./geldar.ps1 check`.

**Commit subject:** `Use: an item and no target puts the item in hand (decision 0389)`

**Out of scope:** the Mind allow-list (it already admits `use` with only `item`), prompts, the scriptorium kit text, persona or goals text, a `hold` verb, entity use, and the fishing rod.

### U0-02: live check (orchestrator, after U0-01 deploys)

1. Live lane (exclusive): a `test:live` case, or a manual Body run on the local shard. Craft a wooden sword, send `use { item: wooden_sword }`, then confirm `self.held_item` is `wooden_sword` in the next snapshot and that the outcome text reads "wooden_sword in hand".
2. The U0-01 merge deploys it (see U0-01). For 48 hours after that, measure from the journals and MCP spans. Nothing here is a target: what agents do is data, and their gate stays theirs (Principles 2 and 5). Agents are not told about the change. Measure:
   - `use` shapes over time: item-only, item+at and item+entity actions, and the item-only success rate.
   - `held_item` over time, not once. The eat and burrow reflexes swap the hand to food or a pickaxe, and nothing restores the sword.
   - Talk of being named, walks and leaving the row, and any change in where agents are.
3. Hypothesis to test (from U0-00): the item-only shape was refused "use needs a block position", so agents added `at`. The first item-only action, 11-17 06:08:49Z, came 19 seconds before the first item+at, 06:09:08Z. If so, the 178 item+at actions still meet "that block cannot be used that way" after the fix, and item-only use may rise once it starts succeeding.
4. Write the result to `docs/analysis/engagement/worknotes/U0-02.md`, then close U0 in the ledger.
