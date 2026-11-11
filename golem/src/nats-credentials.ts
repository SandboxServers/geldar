/**
 * Golem's NATS credentials (decisions 0067 and 0087). The user is `body` unless GELDAR_NATS_USER
 * names another, and the password is read from the file named by GELDAR_NATS_PASSWORD_FILE. With
 * neither variable set the connection is anonymous, as before. The reading itself is `natsAuth`
 * in @geldar/contract/nats; this file only supplies the role default. Spread the result into
 * `connectNats` options. A credential is never logged.
 */
import { NATS_PASSWORD_FILE_ENV, NATS_USER_ENV, natsAuth } from '@geldar/contract/nats';

/** The NATS role of golem (the Body), used as the user name when GELDAR_NATS_USER is unset. */
export const GOLEM_NATS_ROLE = 'body';

/** The `user` and `pass` connect options for golem, or `undefined` for an anonymous connection. */
export function golemNatsAuth(
  env: NodeJS.ProcessEnv = process.env,
): { user: string; pass: string } | undefined {
  const withRole =
    env[NATS_PASSWORD_FILE_ENV] && !env[NATS_USER_ENV]
      ? { ...env, [NATS_USER_ENV]: GOLEM_NATS_ROLE }
      : env;
  return natsAuth({}, withRole);
}
