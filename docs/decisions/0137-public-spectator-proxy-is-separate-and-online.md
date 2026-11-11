# 0137. The public Minecraft port is a separate online-mode spectator proxy; Paper fails closed

- Status: Accepted (orchestrator, 2026-11-11; it implements spec 8.4 and needs no spec change). The owner reviews it with the C2 rulings.
- Date: 2026-11-11
- Spec: 8.4 (spectator proxy: Velocity `online-mode=true`, Microsoft account auth, whitelist by UUID, max 5 concurrent); section 2, Principle 1 (no humans inside). Decisions 0071, 0092, 0096, 0067, 0087.
- Source: C2 wave review, surface R2, round 1 (findings R2-01, R2-02, R2-04, R2-07, R2-09).

## Problem

C2-07a2 published the Colo stack's only Velocity on the public port. That Velocity is the bot ingress: it runs with `online-mode = false`, because the Bodies need it. With no authentication, the login gate trusts the name the client claims. So anyone could connect as a live agent's name whenever that agent's Body is not holding the connection, and be admitted as that agent. The ghost rule, which holds non-agents in spectator, was also racy and failed open.

## Decision

1. **Two Velocity services.**
   - The bot ingress stays offline-mode, is reachable only on the compose network, and is never published.
   - A new public spectator proxy runs with `online-mode = true` and forwards to the same Paper over modern forwarding. Its settings:
     - admission: a whitelist by Microsoft account UUID, empty by default and managed by the owner;
     - capacity: at most 5 players, with the login rate limit on;
     - surface: a neutral MOTD, ping passthrough off (so the agent count is not shown), and the legacy BungeeCord channel off;
     - mode: the identity plugin runs in "public" mode and never admits anyone as live.
   - Only the public spectator proxy appears in `compose/colo-public.yml`.
2. **Paper fails closed.**
   - The bot ingress adds a `geldar_live` profile property at login, and only for registry entries the gate classifies as live. Modern forwarding carries profile properties inside the HMAC-signed forwarding data, so a client cannot forge one.
   - Geldar-Core holds every player without the property in spectator from the first join event; with no timing window.
   - A failure to apply spectator mode kicks the player, and a failed or missing `geldar:ghost` signal disconnects them.
3. **Least privilege.** Both Velocity services read the life registry and skins buckets read-only. The NATS grant drops KV publish and narrows `$JS.API.>`, a correction to the 0087 table.
4. **Deploy guards.**
   - The public bind must be a strict IPv4 address that is not `0.0.0.0`.
   - The port must be between 1 and 65535 and must not be 25565 or 25566.
   - The public publish is merged only after the proxy reports healthy, with its plugin loaded.

## Consequences

- Bodies are unaffected: they still connect to the bot ingress over the compose network.
- A human spectator needs a Microsoft account on the owner's UUID whitelist, and is always a ghost. Combined with 0135 (self-registration), registrants who also want to watch in-game would need a UUID link. That is out of scope here; registration issues MCP tokens, not Minecraft whitelisting.
- The shared forwarding secret means a compromise of the public proxy could forge `geldar_live`. The public proxy is the exposed process, so it runs read-only on NATS and in public mode, and its code never sets the property.
- Packets: C2-02d (fail closed and the missing wiring tests), C2-02c (the public proxy), C2-02e (NATS read-only), and C2-07e (the deploy guards).
