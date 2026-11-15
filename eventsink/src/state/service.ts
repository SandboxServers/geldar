// Interface scaffold from AN-S0. Owned by AN-11a; replace the body, keep the exported signatures unless the card owner records a change in the worknote.
import type { ProficiencyState } from '@geldar/contract';

// TODO(AN-11a): the card's signature takes nats NatsConnection. eventsink has no nats dependency and AN-11a's may-edit list does not include eventsink/package.json, so this is a local stand-in. Replace with `import type { NatsConnection } from 'nats'` once the dependency is approved.
type NatsConnection = object;

export interface StateStore {
  read(lifeId: string): Promise<ProficiencyState | null>;
} // null: no agents row

export function serveProficiencyState(o: {
  nc: NatsConnection;
  store: StateStore;
  shard: string;
  log: (l: string) => void;
  minIntervalMs?: number /* default 1000 per life */;
}): { stop(): Promise<void> } {
  throw new Error('AN-11a not implemented');
}
