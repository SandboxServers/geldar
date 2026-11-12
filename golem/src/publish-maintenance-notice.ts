// Publishes one maintenance notice (CD-1d) on geldar.<shard>.maintenance. deploy/colo-notice.sh runs it as
// `admin notice <payload>` in the one-shot admin container, as the deploy NATS user (GELDAR_NATS_USER=deploy, the password
// read from the file named by GELDAR_NATS_PASSWORD_FILE). That user may publish the maintenance subject and nothing else.
// The payload is checked against maintenance-notice.schema.json before any connection opens. No credential is logged.

import {
  type MaintenanceNotice,
  maintenanceSubject,
  validateMaintenanceNotice,
} from '@geldar/contract';
import { connectNats, NATS_USER_ENV, natsAuth } from '@geldar/contract/nats';

/** The NATS role the notice is published as. Its allow list is the maintenance subject only (nats-auth.conf). */
export const DEPLOY_NATS_ROLE = 'deploy';

/** The slice of a NATS connection the publish uses, so the test can fake it. */
export interface NoticePublisher {
  publish(subject: string, data: Uint8Array): void;
  flush(): Promise<void>;
}

/** Parses the one JSON argument and checks it against the schema. Throws with the schema errors; publishes nothing. */
export function checkNotice(payload: string): MaintenanceNotice {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    throw new Error('the maintenance notice is not valid JSON');
  }
  if (!validateMaintenanceNotice(value)) {
    const errors = (validateMaintenanceNotice.errors ?? []).map(
      (e) => `${e.instancePath || '/'} ${e.message}`,
    );
    throw new Error(`invalid maintenance notice: ${errors.join('; ')}`);
  }
  return value as MaintenanceNotice;
}

/** The `user` and `pass` connect options for the deploy role, read from the password file. Throws for any other role. */
export function deployNatsAuth(env: NodeJS.ProcessEnv = process.env): {
  user: string;
  pass: string;
} {
  if (env[NATS_USER_ENV] !== DEPLOY_NATS_ROLE) {
    throw new Error(`${NATS_USER_ENV} must be ${DEPLOY_NATS_ROLE} to publish a maintenance notice`);
  }
  const auth = natsAuth({}, env);
  if (!auth) throw new Error('the deploy NATS credentials are not set');
  return auth;
}

/** Publishes the notice on the shard's maintenance subject and waits until the server has it. Returns the notice id. */
export async function publishMaintenanceNotice(
  nc: NoticePublisher,
  shard: string,
  notice: MaintenanceNotice,
): Promise<string> {
  const subject = maintenanceSubject(shard);
  nc.publish(subject, new TextEncoder().encode(JSON.stringify(notice)));
  await nc.flush();
  return notice.id;
}

async function main(): Promise<void> {
  const url = process.env.GELDAR_NATS_URL;
  if (!url) throw new Error('GELDAR_NATS_URL is not set');
  const shard = process.env.GELDAR_NOTICE_SHARD;
  if (!shard) throw new Error('GELDAR_NOTICE_SHARD is not set');
  if (process.argv.length !== 3) throw new Error('usage: admin notice <payload-json>');
  const notice = checkNotice(process.argv[2] ?? '');
  maintenanceSubject(shard);
  const nc = await connectNats({
    servers: url,
    name: 'publish-maintenance-notice',
    ...deployNatsAuth(),
  });
  try {
    const id = await publishMaintenanceNotice(nc, shard, notice);
    console.log(`maintenance notice ${id}: published`);
  } finally {
    await nc.close().catch(() => undefined);
  }
}

if (process.argv[1]?.endsWith('publish-maintenance-notice.ts')) {
  main().catch((error: unknown) => {
    console.error(
      `publish-maintenance-notice: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
}
