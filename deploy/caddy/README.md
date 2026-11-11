# deploy/caddy: public read-only sites through the shared Caddy

Decisions: [0071](../../docs/decisions/0071-public-endpoints-and-ports.md) (the shared Caddy is reloaded, never restarted) and [0072](../../docs/decisions/0072-glass-and-bluemap-are-public.md) (Glass and BlueMap are public, read-only, hardened). The open record is [0094](../../docs/decisions/0094-public-sites-read-only-through-caddy.md).

## Files

| Site | Live file | Kill switch | Upstream placeholder |
|---|---|---|---|
| BlueMap map | `map.caddy` | `map-off.caddy` | `{$GELDAR_MAP_UPSTREAM}` |
| Glass | `glass.caddy` | `glass-off.caddy` | `{$GELDAR_GLASS_UPSTREAM}` |
| MCP (`/p/<player_id>` only) | `mcp.caddy` | `mcp-off.caddy` | `{$GELDAR_MCP_UPSTREAM}` |
| Register (GET and POST; off by default, not in `colo-public.sh`) | `register.caddy` | `register-off.caddy` | `{$GELDAR_REGISTER_UPSTREAM}` |

The live and kill-switch files stay in this directory, `deploy/caddy/<site>.caddy`. That is where C2-04 and `deploy/colo-public.sh` look; the `deploy/caddy/sites/` path in the C2-07 card is superseded.

Glass's proxy blocks set `header_up Host localhost`, because Glass answers 421 to any other Host. Glass serves the page (`/`, `/app.css`, `/app.js`, `/js/*`) and the API through Caddy; `/api/stats` is not routed.

Placeholders are read from the environment by Caddy: `GELDAR_DOMAIN` is the project domain, and each upstream is a service address set by the integration packet C2-07. No real domain or IP address is in these files.

## Rules every site keeps

- Only the listed methods pass: GET and HEAD for map and Glass; POST, GET and DELETE for MCP. Every other method gets 405.
- The site strips `x-geldar-client-ip`, `X-Forwarded-For` and `CF-Connecting-IP` from the request, and each `reverse_proxy` sets `x-geldar-client-ip` to `{remote_host}` with `header_up`. The MCP service trusts that header only from Caddy.
- Each site has a request body cap (1 KiB for the read-only sites, 64 KiB for MCP, the same as `BODY_LIMIT_BYTES` in the MCP front).
- Unknown paths get 404 (Glass and MCP). BlueMap serves its own static tree.
- Glass's SSE route (`/api/stream`) and the MCP route flush each chunk at once.

## Rate limits

Core Caddy has no rate limiter, and this repo adds no third-party Caddy module (0094). The limits live in the services: Glass (C2-03) and the public MCP (C2-01).

## Reload procedure

1. Edit the site file, or swap a site for its kill switch (for example `map-off.caddy` in place of `map.caddy`).
2. Validate: `bash deploy/caddy/validate.sh` (uses the pinned caddy image, `docker run --rm` only). CI runs it in the `compose` job.
3. Reload: `caddy reload` on the node.

## Kill procedure

Swap to `<site>-off.caddy` (`deploy/colo-public.sh off <site>`) and reload. `mcp.caddy` and the Glass `/api/stream` route set `stream_close_delay 5s`, which is intended to close open streams on a reload; that is not verified for SSE yet (C2-07 live check). Until it is, restart the MCP container and Glass after the swap. The in-process kill switches of the MCP and of Glass are read at start (ruling R26), so changing them needs a service restart; the Caddy swap is the live switch.

The 405 for a refused method is `handle @not_allowed { respond 405 }`, the first handle in each site, because Caddy sorts a site-level `respond` after `handle` and it would never run. `tools/repo-checks/src/caddy-adapt.test.ts` adapts each file in the pinned image and checks the route order.

Never run `systemctl restart caddy` or restart the container. Caddy serves other sites on the node, and a restart interrupts them all.

## Status

The live reload is an owner or ops step (C2-07). Nothing here has been loaded on a node.
