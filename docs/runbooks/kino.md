# Kino runbook

Kino is the owner-facing 3D view of what one agent sees (decision 0075). It is OFF by default at every layer. It is a window: it sends nothing into the world, and no human acts in the world through it. The agents are never told they are watched.

Three switches, all default off:

| Layer | Setting | Off means |
|---|---|---|
| Plugin | `kino.enabled` in the Geldar-Core `config.yml` (default `false`) | the feed is killed and publishes nothing |
| Glass | `GELDAR_KINO_ENABLED` (default `0`) | no NATS connection, no `/kino/` page, no WebSocket route |
| Caddy | `GELDAR_KINO_ENABLED` in Caddy's environment (default `0`) | `/kino*` on the Glass host answers 404 |

## Enable

1. Sign-in. Kino uses the one `gk_session` cookie of the Glass host, signed in through the register service. Its Microsoft (Entra) app is set by `REGISTER_MS_CLIENT_ID` and the redirect URI is `REGISTER_PUBLIC_URL` plus `/register/callback`, both from the environment. The client secret is a file in the secrets directory (`GELDAR_SECRETS_DIR`), named by `REGISTER_MS_CLIENT_SECRET_FILE`; the conventional file name is `register-ms-client-secret.txt`. Create the file on the node yourself. Its value is never in the repo, in an env file or in a log.
2. NATS. Create a NATS user that may only subscribe to `geldar.*.kino.*.feed`. Put its password in the file `nats-kino.txt` in the secrets directory and set `GELDAR_KINO_NATS_USER` in the deploy env. Add `-f compose/colo-kino.yml` to the compose merge for Glass; the base `colo.yml` keeps Glass free of NATS.
3. Optional metrics. Set `GELDAR_KINO_OTLP_ENDPOINT` to the SigNoz OTLP/HTTP base URL. Unset: nothing is exported. Exported: `kino.panes_open`, `kino.bytes_sent` and `kino.refusals` (label `reason` only; no agent, login or account label).
4. Set `GELDAR_KINO_ENABLED=1` in the Glass deploy env and in Caddy's environment, then recreate Glass (`compose up -d glass`) and reload Caddy (`caddy reload`; never restart it, it serves other sites). Validate Caddy first with `bash deploy/caddy/validate.sh`.
5. Set `kino.enabled: true` in the plugin `config.yml`. The plugin re-reads the file every 5 seconds; no restart is needed.
6. Open `https://glass.<domain>/kino/` while signed in.

## Kill switch

Any one of these stops Kino. Use the first for speed.

1. Plugin: set `kino.enabled: false`. Within 5 seconds every target gets `bye` and the feed stops.
2. Glass and Caddy: set `GELDAR_KINO_ENABLED=0` in both, recreate Glass and reload Caddy. Open panes are closed with `kill_switch`; the route returns 404.
3. Everything on the Glass host: load `glass-off.caddy` (`deploy/colo-public.sh off glass`).

To turn Kino back on, reverse the step you took. A pane that was closed does not reopen by itself; the browser must connect again.

## Audit

Pane opens, targets, mode changes and closes are recorded in `kino_audit` with a hashed login, kept 90 days (Glass purges older rows daily). If an audit write fails, the pane is closed (fail closed).

## Entry page and control path (K09)

`/kino/` is the production page (`glass/web/kino/index.html`, module `main.ts`); `/kino/dev.html` is the mock-feed dev page. The page reads `/kino/targets` (signed-in state and the agents the server lets this viewer watch; anonymous viewers get public-camera agents only), shows a sign-in link when not signed in, and ends a pane on `bye` (including `kill_switch`). Set the `kino-signin-url` and `kino-textures-url` meta tags in `index.html` per deploy (or open `/kino/?textures=<url>`).

Glass asks the plugin to read an agent over NATS on `geldar.<shard>.kino.control` (`kino-control.schema.json`): `start` for the first pane, `resync` for later panes, `refresh` every 15 s while watched, `stop` 10 s after the last pane leaves. The plugin applies these on the server thread only when `kino.enabled` is true; a target not refreshed for 45 s is stopped, so a Glass restart leaves nothing running. NATS permissions: Glass may publish `geldar.<shard>.kino.control` and subscribe `geldar.<shard>.kino.*.feed`; the plugin the reverse.