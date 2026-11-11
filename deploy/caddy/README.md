# deploy/caddy: public read-only sites through the shared Caddy

Decisions: [0071](../../docs/decisions/0071-public-endpoints-and-ports.md) (the shared Caddy is reloaded, never restarted) and [0072](../../docs/decisions/0072-glass-and-bluemap-are-public.md) (Glass and BlueMap are public, read-only, hardened). The open record is [0094](../../docs/decisions/0094-public-sites-read-only-through-caddy.md).

## Files

| Site | Live file | Kill switch | Upstream placeholder |
|---|---|---|---|
| BlueMap map | `map.caddy` | `map-off.caddy` | `{$GELDAR_MAP_UPSTREAM}` |
| Glass | `glass.caddy` | `glass-off.caddy` | `{$GELDAR_GLASS_UPSTREAM}` |
| MCP (`/p/<player_id>` only) | `mcp.caddy` | `mcp-off.caddy` | `{$GELDAR_MCP_UPSTREAM}` |

Placeholders are read from the environment by Caddy: `GELDAR_DOMAIN` is the project domain, and each upstream is a service address set by the integration packet C2-07. No real domain or IP address is in these files.

## Rules every site keeps

- Only the listed methods pass: GET and HEAD for map and Glass; POST, GET and DELETE for MCP. Every other method gets 405.
- The site strips `x-geldar-client-ip`, `X-Forwarded-For` and `CF-Connecting-IP` from the request, then sets `x-geldar-client-ip` to `{remote_host}`. The MCP service trusts that header only from Caddy.
- Each site has a request body cap (1 KiB for the read-only sites, 64 KiB for MCP, the same as `BODY_LIMIT_BYTES` in the MCP front).
- Unknown paths get 404 (Glass and MCP). BlueMap serves its own static tree.
- Glass's SSE route (`/api/stream`) and the MCP route flush each chunk at once.

## Rate limits

Core Caddy has no rate limiter, and this repo adds no third-party Caddy module (0094). The limits live in the services: Glass (C2-03) and the public MCP (C2-01).

## Reload procedure

1. Edit the site file, or swap a site for its kill switch (for example `map-off.caddy` in place of `map.caddy`).
2. Validate: `bash deploy/caddy/validate.sh` (uses the pinned caddy image, `docker run --rm` only).
3. Reload: `caddy reload` on the node.

Never run `systemctl restart caddy` or restart the container. Caddy serves other sites on the node, and a restart interrupts them all.

## Status

The live reload is an owner or ops step (C2-07). Nothing here has been loaded on a node.
