# BLD-fix4a: review fixes 4a (player hosts, seed script, survey size)

Base: 6fe2448b (building/integration). Branch phase1/bld-fix4a-hosts-seed.

## A1: player hosts open the building buckets

- `golem/src/players/main.ts` and `golem/src/players/managed-main.ts` now call `restartKvFor(config, natsUrl)`
  (the helper in `adam/main.ts`), so `body_actions.building` decides whether `geldar-plans` and `geldar-seen`
  are opened. Off: neither is opened (as before).
- Tests: `players/main-host.test.ts` (runPlayer, flag on and off), `players/managed-restart.test.ts` (runManagedBody,
  flag on and off, and the connection close on a KV failure).

## A2: the seed one-shot creates the identity buckets only

- `seed-buckets.ts` `main()` calls `seedIdentityBuckets` only. `seedBuildingBuckets` stays exported for an explicit
  use. `seedAllBuckets` is removed (nothing used it once `main` changed), with its test.
- The `seed` NATS role may create only the two identity streams, so the building buckets are created by the Body
  itself at start (flag on). `main` is exported and tested (`seed-buckets-main.test.ts`).
- Compose comments say "the two identity buckets", which is correct now: left unchanged.

## A3: a survey box over the cell cap

- The Body's `box_too_large` refusal comes back from `NatsBodyGateway.survey` as data (as `plan_too_large` does for
  plan_check). `surveyTool` turns it into the existing `invalid_input` code, and the `invalid_input` message now
  names the 32768-cell cap. No contract schema changed.
- Tests: `survey-gateway.test.ts` (gateway returns the refusal; tool round trip gives `invalid_input`).

## B5 and the addendum

- `PLAN_METRICS` deleted from `golem/src/building/names.ts` (no importers).
- `threshold/mcp/src/body-gateway.ts` header comment no longer says the survey and plan_check methods are unsent.
