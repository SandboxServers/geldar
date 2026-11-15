// Interface scaffold from AN-S0. Owned by AN-11b; replace the body, keep the exported signatures unless the card owner records a change in the worknote.
// CharacterSheet is psyche's type here; the contract's ProficiencyState.sheet uses the generated contract type (see the worknote conflict list).
import type { CharacterSheet, Domain } from '@geldar/psyche';

export interface StateTransport {
  request(subject: string, body: string, timeoutMs: number): Promise<string>; // rejects on timeout or no responders
  subscribe(subject: string, onMessage: (body: string) => void): () => void; // returns unsubscribe
}

export class ProficiencyCache {
  constructor(o: {
    transport: StateTransport;
    shard: string;
    lifeId: string;
    thresholds?: readonly [number, number, number];
    timeoutMs?: number /* 2000 */;
    attempts?: number /* 3 */;
    retryMs?: number /* 15000 */;
    log: (l: string) => void;
  }) {
    throw new Error('AN-11b not implemented');
  }

  async start(): Promise<void> {
    throw new Error('AN-11b not implemented'); // subscribe first, then request; never throws
  }

  level(domain: Domain): 0 | 1 | 2 | 3 {
    throw new Error('AN-11b not implemented'); // always answers, from memory
  }

  get version(): number {
    throw new Error('AN-11b not implemented');
  }

  get degraded(): boolean {
    throw new Error('AN-11b not implemented');
  }

  get baseline(): { sheet: CharacterSheet; hash: string } | null {
    throw new Error('AN-11b not implemented');
  }

  async refresh(): Promise<void> {
    throw new Error('AN-11b not implemented'); // used on reconnect
  }

  stop(): void {
    throw new Error('AN-11b not implemented'); // unsubscribes, cancels the retry timer
  }
}
