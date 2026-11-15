// Interface scaffold from AN-S0. Owned by AN-10b; replace the body, keep the exported signatures unless the card owner records a change in the worknote.
import type { Pool } from 'pg';

export interface LevelPush {
  publish(subject: string, body: string): void;
} // core NATS publish

export function startOutboxPublisher(o: {
  pool: Pool;
  push: LevelPush;
  intervalMs?: number /* default 2000 */;
  batch?: number /* default 100 */;
  log: (l: string) => void;
}): { stop(): Promise<void>; drainOnce(): Promise<number> } {
  throw new Error('AN-10b not implemented');
}
