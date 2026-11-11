/**
 * The relay's feed source on NATS: one subscription per watched agent on
 * `geldar.<shard>.kino.<agent_id>.feed` (kino-feed.schema.json).  Subscribe on the feed: Glass publishes
 * only the control subject (kino-control.schema.json, see control.ts). Loaded only when Kino is enabled, so a default Glass opens no NATS connection.
 */
import { readFileSync } from 'node:fs';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import { controlSubject } from './control.ts';
import { type NatsLink, type SupervisedFeed, supervisedFeed } from './supervised-feed.ts';

const AGENT = /^[a-z][a-z0-9_]{0,63}$/;
const SHARD = /^[a-z][a-z0-9-]*$/;

export interface NatsFeedOptions {
  url: string;
  shard: string;
  /** NATS credentials from GELDAR_NATS_USER and the password file; both unset: unauthenticated. */
  user?: string | undefined;
  passwordFile?: string | undefined;
}

/** The subject for one agent. Throws on a name that is not one subject token. */
export function feedSubject(shard: string, agent: string): string {
  if (!SHARD.test(shard) || !AGENT.test(agent)) throw new Error('invalid kino subject token');
  return `geldar.${shard}.kino.${agent}.feed`;
}

/** Opens one NATS connection; rejects when the server is down or refuses the user. */
async function connectNats(o: NatsFeedOptions): Promise<NatsLink> {
  const auth =
    o.user && o.passwordFile
      ? { user: o.user, pass: readFileSync(o.passwordFile, 'utf8').trim() }
      : {};
  const nc: NatsConnection = await connect({
    servers: o.url,
    name: 'geldar-glass-kino',
    maxReconnectAttempts: -1,
    ...auth,
  });
  return {
    publish: (subject, data) => nc.publish(subject, data),
    subscribe: (subject) => nc.subscribe(subject),
    closed: () => nc.closed(),
    drain: () => nc.drain(),
  };
}

/** The Kino feed on NATS. Never rejects: a missing server or user leaves Kino disabled and retries in the background. */
export function natsFeed(o: NatsFeedOptions): SupervisedFeed {
  return supervisedFeed({
    connect: () => connectNats(o),
    feedSubject: (agent) => feedSubject(o.shard, agent),
    controlSubject: controlSubject(o.shard),
  });
}
