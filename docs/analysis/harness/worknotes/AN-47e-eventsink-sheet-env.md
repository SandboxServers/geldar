# AN-47e worknote: eventsink sheet switch through the node env file

## What changed

- `compose/colo.yml`, eventsink service: `GELDAR_SHEET_SHARD`, `GELDAR_XP` and `GELDAR_PROFICIENCY_THRESHOLDS` are passed
  through from the host as `"${NAME:-}"`. With the node env file empty or silent, the container gets empty strings.
- Default is OFF. The node turns the state service on by setting `GELDAR_SHEET_SHARD=colo` in the node env file and
  recreating eventsink through `dc()` in `deploy/common.sh`. `GELDAR_XP` stays unset until the XP producers are on.
- `compose/opt-in/sheet-sink.yml` stays. It now duplicates the colo keys, so its header says it is for a stack whose
  file leaves them out (phase0). Same values, so the double set is harmless.

## Why the overlay was not enough

`deploy/common.sh` `dc()` always merges the nats-auth and secrets overlays, and a CD recreate of eventsink drops any
overlay that was passed by hand. `GELDAR_COLO_EXTRA_OVERLAY` already carries `colo-kino.yml`. The variables must be in
`colo.yml` to survive a recreate.

## Empty string equals unset (checked)

- `sinkPlan`: `GELDAR_SHEET_SHARD` is trimmed and a blank value is `undefined` (no state service, no outbox publisher).
- `xpEnabled`: only `'1'` is on, so `''` is off.
- `xpThresholds`: read only when XP is on; blank gives `DEFAULT_THRESHOLDS`.
- Result: three blanks give the same plan as no variables, and `startShardServices` starts nothing. No parse changed.
- Tests: `eventsink/src/sink-plan.test.ts` (three blanks equal unset) and `eventsink/src/sheet-sink-override.test.ts`
  (colo eventsink carries each variable once as an empty pass-through).

## Corrections to earlier notes

- AN-12b.md says `colo.yml` and `phase0.yml` already passed the three variables through. At `db3be6d6` `colo.yml` did
  not; this card adds them. The `GELDAR_SHARD` wording in AN-12b is the old name; the deviation line there is right.
- `docs/analysis/progression/README.md` and `RESUME.md` still say colo sets no `GELDAR_XP` or `GELDAR_SHEET_SHARD`.
  True for XP; the sheet shard is now a node env switch.

## Owed

- The node env file value `GELDAR_SHEET_SHARD=colo` is an operator step, not part of this card.
- Live check after the operator sets it: `docker compose ... exec eventsink env | grep GELDAR_` shows the shard, XP empty.
