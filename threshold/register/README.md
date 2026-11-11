# threshold/register

The self-registration service (decision 0135): GitHub or Discord sign-in, then owners, players and tokens in
Postgres. It connects as the `geldar_register` role. The role holds no table privilege at all: it writes and
reads only through the `register_*` SECURITY DEFINER functions (migrations 0009 to 0012). The starting credits
are a constant in `register_create_player`, checked by a repo check against `sovereign.budget.cap_credits` in
`shards/colo-mind.yaml`.

## Known limits

A compromised register service can act as any registered owner. The service holds the HMAC pepper, so it can
derive the identity hash of any provider id it knows and pass that to the definer functions; a database check
cannot tell that from a real sign-in. The role cannot list identity hashes (it has no SELECT on the identity
table), so it cannot name an owner it has not seen. The definer functions limit what a compromise can do to
register-owned tables (owners, identities, players, their agents rows, budgets and tokens) and to the caps
the database enforces: 10 lifetime players per owner, the owner cap, and the daily new-owner cap (10 per
24 hours, counted under an advisory lock inside `register_create_owner`, migration 0013). The service checks
the same daily cap before it calls the function. Owners are free to create within that cap, so the lifetime
cap is per owner, not per person.
