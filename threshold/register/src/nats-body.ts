// The register's NATS link for the body routes (C7-04c2). Startup never waits for NATS: the link opens on the first
// body request, so an unreachable server is a 503 body_unavailable at request time, never a failed start.
import { connectNats } from '@geldar/contract/nats';
import { bodyRoutes } from './api/body.ts';
import { bodyRetireRoutes } from './api/body-retire.ts';
import { type BodySlot, createBodySlot } from './api/body-slot.ts';
import type { ApiRoute } from './api/route.ts';
import type { RegisterNats } from './config.ts';
import type { CtlConnection } from './nats-ctl.ts';

type NatsLink = Awaited<ReturnType<typeof connectNats>>;
/** The connect function. Production passes connectNats; tests pass a fake. */
export type ConnectNats = typeof connectNats;

/**
 * A CtlConnection that opens its NATS link on the first request and reuses it. One connect attempt per request and no
 * register-side retry: a failed connect rejects that request (503 through requestBodyOp), and the next request tries
 * again. A link closed for good is dropped, so the next request opens a new one. The request's own timeout bounds the
 * connect too. The link's auto-reconnect is the contract's (connectNats sets maxReconnectAttempts to -1, no cap).
 */
export function lazyCtlConnection(
  settings: RegisterNats,
  log: (line: string) => void,
  connect: ConnectNats = connectNats,
): CtlConnection {
  let link: Promise<NatsLink> | null = null;
  const open = (): Promise<NatsLink> => {
    if (link === null) {
      const pending: Promise<NatsLink> = connect(
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

/** The database retire of the owner's player (PgStore.retirePlayer). */
export type RetirePlayer = (identityHash: string, playerId: string) => Promise<boolean>;

/**
 * The body routes and their one shared slot (C7-04c2). Without NATS in the config the routes are empty, so every body
 * path is 404 through the router. The retire route (C7-04d-mount) is appended to the body routes with the same slot and
 * the same link, only with NATS configured and a retirePlayer given (null leaves it unmounted). The slot is returned too.
 */
export function bodyWiring(
  config: {
    readonly nats: RegisterNats | null;
    readonly natsPasswordUnreadable: boolean;
    readonly shard: string;
  },
  log: (line: string) => void,
  connect: ConnectNats = connectNats,
  retirePlayer: RetirePlayer | null = null,
): { readonly routes: readonly ApiRoute[]; readonly slot: BodySlot } {
  const slot = createBodySlot();
  if (config.nats === null) {
    log(
      config.natsPasswordUnreadable
        ? 'body routes unmounted: REGISTER_NATS_PASSWORD_FILE is unreadable or empty'
        : 'body routes unmounted: NATS is not configured',
    );
    return { routes: [], slot };
  }
  const shared = {
    conn: lazyCtlConnection(config.nats, log, connect),
    shard: config.shard,
    timeoutMs: config.nats.timeoutMs,
    slot,
  };
  const routes = [
    ...bodyRoutes(shared),
    ...(retirePlayer ? bodyRetireRoutes({ ...shared, retirePlayer }) : []),
  ];
  log('body routes mounted');
  return { routes, slot };
}

/**
 * The body wiring as main.ts composes it: the retire goes to the store's retirePlayer. main calls this function, so a
 * test can prove the retire route reaches the store (a main that drops the argument would fail that test).
 */
export function productionBodyWiring(
  config: Parameters<typeof bodyWiring>[0],
  store: { readonly retirePlayer: RetirePlayer },
  log: (line: string) => void,
  connect: ConnectNats = connectNats,
): ReturnType<typeof bodyWiring> {
  return bodyWiring(config, log, connect, (identityHash, playerId) =>
    store.retirePlayer(identityHash, playerId),
  );
}

/**
 * The API the register serves: the production members, with the routes replaced by the body routes (C7-04c2). main.ts
 * calls this, so the mount is tested through this function and not only through the wiring behind it.
 */
export function mountBodyApi<A extends object>(
  api: A,
  body: { readonly routes: readonly ApiRoute[] },
): A & { readonly routes: readonly ApiRoute[] } {
  return { ...api, routes: body.routes };
}
