/**
 * The one way Geldar opens a NATS connection. The client's default gives up after 10 reconnects
 * (about 20 s) and then stays closed with nothing watching it, so a service silently stops. Here
 * the reconnect policy is unbounded, and a connection that closes with an error ends the process
 * with exit code 1 so its supervisor restarts it. A clean close (`close()` called by the code) is
 * not an error and does not exit.
 */
import { type ConnectionOptions, connect, type NatsConnection } from '@nats-io/transport-node';

/** Called when the connection closes with an error; the default exits the process with code 1. */
export type OnFatalClose = (error: Error, name: string) => void;

/** Logs why the connection closed and exits with code 1, so the supervisor restarts the process. */
export const exitOnFatalClose: OnFatalClose = (error, name) => {
  console.error(
    `${name}: NATS connection closed (${error.message}); exiting so the supervisor restarts it`,
  );
  process.exit(1);
};

/**
 * Connects with `maxReconnectAttempts: -1` (the caller's value is overridden) and watches the
 * connection: a close that carries an error calls `onFatalClose`. Pass `options.name` and
 * `options.servers` as for `connect`.
 */
export async function connectNats(
  options: ConnectionOptions & { name: string; servers: string },
  onFatalClose: OnFatalClose = exitOnFatalClose,
): Promise<NatsConnection> {
  const nc = await connect({ ...options, maxReconnectAttempts: -1 });
  nc.closed().then((reason) => {
    if (reason instanceof Error) onFatalClose(reason, options.name);
  });
  return nc;
}
