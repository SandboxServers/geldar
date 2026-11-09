# 0021. Velocity bot ingress from Phase 0, matching production

- Status: Accepted (owner, 2026-11-08)
- Date: 2026-11-08
- Spec: section 5.1 (connection paths), section 6.5, section 6.7, section 10 Phase 0, Appendix F (bot ingress identity)

## Decision

Phase 0 runs the production connection path from day one:

- Bots reach the world only through the **bot-ingress Velocity proxy** (`online-mode=false`, modern forwarding with a shared secret). In Phase 0 it listens on `127.0.0.1:25565`, standing in for the internal VLAN that only the Body host can reach.
- **Paper accepts only Velocity-forwarded connections** and publishes no game port; it is reachable only on the compose network. `white-list=true` as in spec 5.1: Golem whitelists a bot over RCON before connecting, as the supervisor will.
- **Secrets are Docker secret files** (RCON, Postgres, the forwarding secret), generated locally by `./geldar.ps1 shard secrets` into a gitignored folder, never environment values or committed files (spec 6.7).
- The **Geldar identity-check plugin** for Velocity (Appendix F: admit only usernames registered for a living life ID) is built in Phase 0 too, in wave 3. Until then Velocity forwards any offline-mode username that Paper's whitelist allows.

## Why

The owner wants Phase 0 to match the production environment as closely as possible, so problems with forwarding, whitelisting, secrets and identity show up now rather than in Phase 2. Spec section 10 says Velocity "doesn't exist yet" in Phase 0, but the same paragraph builds "the bot ingress", which Appendix F defines as a Velocity plugin. This record settles that contradiction in favor of the production path.

## Consequences

- Packet P0-06 adds a `velocity` service, Paper's forwarding config and secret files; P0-07 connects through Velocity and whitelists over RCON; P0-13 adds the identity plugin.
- The spectator proxy (the second, internet-facing Velocity for ghosts) is still Phase 2.
- One more moving part on day one: a bot that can't join may be a forwarding or whitelist problem, not a Mineflayer one. The `run-shard` health table checks the proxy separately.
