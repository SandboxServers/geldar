# geldar-mcp-mock

A stand-in for the Threshold MCP server with the real tool contract (`@geldar/contract`) and a deterministic fake world. OAuth is replaced by one bearer token per player (D-SC-12). Nothing is called outside the process; no model runs.

## Commands

```
# run from source (Node 22.23.2, type stripping)
./geldar.ps1 pnpm --filter @geldar/mcp-mock exec node src/cli.ts --tokens threshold/mcp-mock/tokens.example.json

# run the image (tokens file mounted read-only; see compose.example.yml)
docker run --rm -p 127.0.0.1:8787:8787 -v "$PWD/mcp-tokens.json:/run/secrets/mcp-tokens.json:ro" ghcr.io/sandboxservers/geldar-mcp-mock:main

# point a player at it: mcp_url http://127.0.0.1:8787/p/<player_id>, GELDAR_MCP_TOKEN = that player's token
```

## Tokens file

A JSON object of player id to token: `{ "alice": "<token>" }`. Generate a token with `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"`. See `tokens.example.json` (fake values). Inside the container the file must be readable by uid 1000 (`chmod 644`, or a matching owner).

## Scenario file keys

| Key | Meaning |
|---|---|
| `name` | scenario name |
| `day_length_seconds` | length of a day in real seconds (default 2400) |
| `character` | name, `life_id`, `born_day`, `seed`, `position`, `food`, `inventory`, `facts`, `budget` |
| `neighbours` | named agents with a position |
| `books` | readable books (`text` or `skill`) |
| `events` | timed world events, sorted by `at_tick` |
| `wake` | `min_spacing_seconds`, `intent_run_too_long_seconds` |
| `intent` | `default_ticks` |
| `reflex` | `hunger_interval_ticks`, `eat_below` |
| `shard_rules` | `chat_radius` |
| `laws` | `{ rule, value }` entries |

## CI time knobs

`--day-length-seconds`, `--min-wake-spacing-seconds`, `--intent-run-too-long-seconds` override the scenario; `--suppressed-log <file>` records suppressed wakeups.

## Things to know

- The wake and interest vocabulary is PROVISIONAL: it is the mock's proposal and the real server may differ.
- The fallback wakeup is set in seconds (300 s is 6000 ticks at 20 TPS, spec 7).
- Two clients on one player supersede each other.
- The budget does not refill: a Wave 5 session of 40 real minutes spends it; raise `character.budget` in the scenario.
- A 401 for an unknown player against a 403 for a known player with another's token tells a token holder which players exist (acceptable for a mock).

## Not modelled

OAuth, token versions and refresh, presence lease and hibernation, fatigue, real pathing, the colo sandbox, per-tool scopes, a second `wait` while one is open.