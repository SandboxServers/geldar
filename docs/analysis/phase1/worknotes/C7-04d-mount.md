# C7-04d-mount worknote: retire route in the NATS wiring

**Mount.** `bodyWiring` in `threshold/register/src/nats-body.ts` takes a fourth argument, `retirePlayer` (the store's
`retirePlayer`, default null). With NATS configured and a `retirePlayer` given, the routes are the body routes plus
`bodyRetireRoutes({ conn, shard, timeoutMs, slot, retirePlayer })`. Both sets take the same `conn`, the same
`timeoutMs` and the same slot object (`createBodySlot()` made once in `bodyWiring`), and that slot is returned.

**Off by default.** Without `REGISTER_NATS_*` the early return gives no routes, so the retire path is 404 through the
router and no NATS link opens. A null `retirePlayer` leaves the retire route unmounted even with NATS (a test).

**main.ts.** Passes `connectNats` and `(h, p) => store.retirePlayer(h, p)` to `bodyWiring`. The `slot` it returns is
not needed by main: the slot is already inside the routes.

**Tests.** `threshold/register/test/body-wiring.test.ts`, describe "retire route in the NATS wiring (C7-04d-mount)".
Revert-checks (each fails): retire append removed (503 and 409 tests fail); slot copied for the body routes or the
retire (409 tests fail); retire mounted without NATS (unmounted-by-default test fails).

**No SQL, no migration.**
