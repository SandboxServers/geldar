# Wave M interface requests

Requests from the WM-03 front door to other packets, and questions for the owner. Each entry names the packet that owns the change.

## WM-03 requests

### R1: `TokenStore.resolve` looks up by digest, not by token (owner: WM-01 / WM-02)

The front door passes `resolve` the HMAC-SHA256 digest of the presented bearer, keyed with the pepper (spec 5.15.3, `tokenDigest` in `threshold/mcp/src/http/auth.ts`). The store must find the row by that digest, as an indexed lookup. Equality on a digest of a high-entropy token is not a practical timing channel, so no constant-time scan of tokens is needed in the store. The raw token must never reach the store.

### R2: `FakeTokenStore` should compare digests in constant time (owner: WM-01)

`threshold/mcp/src/fakes/stores.fakes.ts` loops over tokens with `equalBytes`. The fake should compare the digests in constant time (`timingSafeEqual` on equal-length buffers), so a test cannot depend on a timing shortcut. WM-03 did not edit this WM-01 file.

### R3: The resolved player id is compared in constant time (done in WM-03)

`verifyBearer` compares the resolved player id with the URL's player id using `timingSafeEqual` (`sameText` in `auth.ts`). Nothing for WM-01 to change.

## Owner questions

### Q1: Rate-limit numbers the front door relies on

The limiter's capacities come from the injected `RateLimiter`, so the WM-01 wiring must set them. The numbers below come from `threshold/mcp/src/config.ts` and `phase0.yaml`:

- `calls_per_minute: 60` per player (`player:<id>` bucket)
- `owner_calls_per_minute: 600` per owner (`owner:<id>` bucket)
- `failed_auth_per_minute: 30` per client address (`auth-failed:address:<addr>`)
- Global failed-auth limit of 300 a minute: stated in the `phase0.yaml` comment as "in code", but no config key exists. The front door takes it from the limiter's `auth-failed:global` bucket, so the wiring must set 300 there.
- Open requests per player: 4 (`MAX_OPEN_PER_PLAYER` in `threshold/mcp/src/http/limits.ts`, a code constant).

Question for the owner: confirm 300 a minute for the global failed-auth bucket, and whether it should be a config key. Until confirmed, the constant stays in the wiring, not in the front door.

### Q2: Token for another player, and an unknown player

A valid token sent to another player's path is refused with 403 (the stricter reading: the token is valid, its scope is wrong). An unknown player with an unknown token is 401. Confirm this matches decision 0035.

### Q3: Trailing whitespace in the Authorization header

Node's HTTP parser strips trailing whitespace from header values before the handler sees them, so `Bearer <token> ` cannot be tested through HTTP and is accepted as `Bearer <token>`. The stricter parse still refuses lowercase `bearer` and a double space. Confirm this is acceptable.

## Decisions

The orchestrator decided these questions. They close Q1 to Q3 and confirm R1 and R2.

- Q1: The global failed-auth limit of 300 a minute is accepted. It stays a wiring constant for now and is tunable later.
- Q2: A valid token sent to another player's path returns 403. An unknown player with an unknown token returns 401.
- Q3: The trailing-space header gap is accepted. Node strips trailing whitespace from header values, so the gap cannot be reached through HTTP.
- R1 and R2 (owner: WM-01 / WM-02): `TokenStore.resolve` must look up the row by the HMAC digest of the bearer, not by the raw token. `FakeTokenStore` must compare digests in constant time.
