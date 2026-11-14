// The register's NATS link for the body routes (C7-04c2). Startup never waits for NATS: the link opens on the first
// body request, so an unreachable server is a 503 body_unavailable at request time, never a failed start.
import { connectNats } from '@geldar/contract/nats';
import { bodyRoutes } from './api/body.ts';
import { type BodySlot, createBodySlot } from './api/body-slot.ts';
import type { ApiRoute } from './api/route.ts';
import type { RegisterNats } from './config.ts';
import type { CtlConnection } from './nats-ctl.ts';

type NatsLink = Awaited<ReturnType<typeof connectNats>>;

/**
 * A CtlConnection that opens its NATS link on the first request and reuses it. One connect attempt per request and no
 * register-side retry: a failed connect rejects that request (503 through requestBodyOp), and the next request tries
 * again. A link closed for good is dropped, so the next request opens a new one. The request's own timeout bounds the
 * connect too. The link's auto-reconnect is the contract's (connectNats sets maxReconnectAttempts to -1, no cap).
 */
export function lazyCtlConnection(
  settings: RegisterNats,
  log: (line: string) => void,
): CtlConnection {
  let link: Promise<NatsLink> | null = null;
  const open = (): Promise<NatsLink> => {
    if (link === null) {
      const pending: Promise<NatsLink> = connectNats(
        {
          name: 'geldar-register',
          servers: settings.url,
          user: settings.user,
          pass: settings.password,
        },
        () => {
          // A fatal close is logged and the link dropped: the process does not exit (the register serves on).
          log('body nats link closed');
          if (link === pending) link = null;
        },
      );
      link = pending;
      pending.catch(() => {
        log('body nats link refused');
        if (link === pending) link = null;
      });
    }
    return link;
  };
  return {
    async request(subject, data, opts) {
      const nc = await open();
      return nc.request(subject, data, opts);
    },
  };
}

/**
 * The body routes and their one shared slot (C7-04c2). Without NATS in the config the routes are empty, so every body
 * path is 404 through the router. The slot is returned too, so the retire route (C7-04d) can share it.
 */
export function bodyWiring(
  config: { readonly nats: RegisterNats | null; readonly shard: string },
  log: (line: string) => void,
): { readonly routes: readonly ApiRoute[]; readonly slot: BodySlot } {
  const slot = createBodySlot();
  if (config.nats === null) {
    log('body routes unmounted: NATS is not configured');
    return { routes: [], slot };
  }
  const routes = bodyRoutes({
    conn: lazyCtlConnection(config.nats, log),
    shard: config.shard,
    timeoutMs: config.nats.timeoutMs,
    slot,
  });
  log('body routes mounted');
  return { routes, slot };
}
