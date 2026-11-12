# 0149. The act budget is suspended and every act is metered

Status: accepted, temporary. Owner direction, phase 1 (C6): "Remove budgets for now; we need to see what everything costs: good, bad and impossible."

## Decision

The act budget (credits per life, accrued per real hour, reserved per item, refused with `budget_exhausted`) and the per-life act rate limit are not enforced by default. Every act is still metered, so the owner can see what it would have cost.

- Enforcement is a config switch: the environment variable `GELDAR_ACT_BUDGET_ENFORCE`. Only the value `1` turns enforcement on. Unset, `0` or any other value leaves it off.
- With enforcement off, `act` does not reserve credits, does not refuse on a short balance, does not refund, and does not take the per-life `act:` rate limit.
- Abuse protections that are not game budgets are unchanged: the HMAC and Bearer auth, the request size limit, the per-session concurrency cap, the public-edge rate limit and the kill switch.

## What is metered

Each `act` writes a `sovereign_call` event with three added fields:

- `would_cost`: the credits the whole thought would have cost, one per say, action and intent, accepted or not.
- `outcome_class`: `good` when an item was accepted; `bad` when the Body refused the plan, or the call failed after it was sent; `impossible` when nothing reached the Body (the validator or a precondition refused every item).
- `spent_this_life`: the running total of the credits the accepted items would have cost, for the life, including this call.

The event also carries the existing `tool`, `latency_ms` (the duration), `accepted` and `rejected`. The running totals per life are kept in memory by `ActMeter` (`threshold/mcp/src/budget/meter.ts`).

The `status` tool shows the same totals for the life, so an agent or the owner can read them without the event stream (`StatusResult` in `contract/schemas/mcp-world.schema.json`):

- `spent_this_life`: the same running total as the event field.
- `would_have_been_balance`: the balance less `spent_this_life`. It can be negative: it is the balance the life would have had if its acts were charged.
- `metered_acts`: the counts for the life, `calls`, `good`, `bad` and `impossible`.

## How to re-enable

Set `GELDAR_ACT_BUDGET_ENFORCE=1` in the MCP service environment and restart it. No code change is needed.

## Not done in this pass

- The running totals are in memory, so they reset when the MCP process restarts. The event stream is the durable record.
- Owner follow-up: the thought prompts (`prompts/thought/v1.md` to `v3.md`) show a line `Thinking credits: {{credits}}`. Released templates are not edited. The owner decides the wording; the change is a new template version with its drift tests and allow-lists updated.
- The `wait`, `say` and other charged tools are not yet metered. Only `act` is.
