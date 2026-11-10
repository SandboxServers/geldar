/**
 * The one way Geldar opens a NATS connection. The client's default gives up after 10 reconnects
 * (about 20 s) and then stays closed with nothing watching it, so a service silently stops. Here
 * the reconnect policy is unbounded, and a connection that closes with an error ends the process
 * with exit code 1 so its supervisor restarts it. A clean close (`close()` called by the code) is
 * not an error and does not exit.
 *
 * Credentials (decision 0067) come from the options (`user`, `pass`) or, when those are unset,
 * from `GELDAR_NATS_USER` and `GELDAR_NATS_PASSWORD_FILE` (a file holding the password). With
 * neither set the connection is unauthenticated, as before. A credential is never logged.
 */
import { readFileSync } from 'node:fs';
import { type ConnectionOptions, connect, type NatsConnection } from '@nats-io/transport-node';

export const NATS_USER_ENV = 'GELDAR_NATS_USER';
export const NATS_PASSWORD_FILE_ENV = 'GELDAR_NATS_PASSWORD_FILE';

/**
 * The user and password for a connection, or `undefined` for an unauthenticated one. Options win
 * over the environment. Errors name a variable or a path, never a password.
 */
export function natsAuth(
  options: { user?: string; pass?: string },
  env: NodeJS.ProcessEnv = process.env,
): { user: string; pass: string } | undefined {
  if (options.user) return { user: options.user, pass: options.pass ?? '' };
  const user = env[NATS_USER_ENV];
  const passwordFile = env[NATS_PASSWORD_FILE_ENV];
  if (!user && !passwordFile) return undefined;
  if (!user) throw new Error(`${NATS_PASSWORD_FILE_ENV} is set but ${NATS_USER_ENV} is not`);
  if (!passwordFile)
    throw new Error(`${NATS_USER_ENV} is set but ${NATS_PASSWORD_FILE_ENV} is not`);
  let pass: string;
  try {
    pass = readFileSync(passwordFile, 'utf8').trim();
  } catch {
    throw new Error(
      `cannot read the NATS password file named by ${NATS_PASSWORD_FILE_ENV}: ${passwordFile}`,
    );
  }
  if (!pass) throw new Error(`the NATS password file named by ${NATS_PASSWORD_FILE_ENV} is empty`);
  return { user, pass };
}

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
  const auth = natsAuth(options);
  const nc = await connect({ ...options, ...auth, maxReconnectAttempts: -1 });
  nc.closed().then((reason) => {
    if (reason instanceof Error) onFatalClose(reason, options.name);
  });
  return nc;
}
