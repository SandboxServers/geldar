# Wave M interface requests

Requests from one packet to another, raised while a packet was built on a branch that did not yet have what it needed.

## WM-05

- **WM-11: use PlayerLog.head() from WM-04 for say's start cursor; plan_result needs thought_id and said.** `say` reads the Body's `plan_result` from the life's event log. WM-05 takes its start cursor from the `PlayerEventLog` port WM-01 defined (the newest sequence `since(lifeId, 0)` returns, taken before the plan is sent), because WM-04's `head()` cursor is on an unmerged branch. WM-11 should swap that for `PlayerLog.head()`. The `plan_result` event must carry `thought_id` and `said`; `planResultFor` in `threshold/mcp/src/tools/say.ts` reads both.
- **Body rate-limit refusal maps to `body_refused`.** `plan_result` has no reason field, so a refusal by the Body's own rate limit (`said: false`) is reported as the existing `body_refused` outcome, not as a separate reason. Revisit if the Body starts sending a reason.
