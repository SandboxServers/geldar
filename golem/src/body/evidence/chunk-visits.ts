// Interface scaffold from AN-S0. Owned by AN-09b; replace the body, keep the exported signatures unless the card owner records a change in the worknote.
import type { WorldEvent } from '@geldar/contract';
import type { Bot } from 'mineflayer';

export interface ChunkWatchOptions {
  bot: Bot;
  shard: string;
  lifeId: string;
  tick: () => number;
  publish: (event: WorldEvent) => void;
  now?: () => Date;
  log: (l: string) => void;
  maxKnown?: number /* default 20000 */;
}

// returns stop()
export function watchChunkVisits(options: ChunkWatchOptions): () => void {
  throw new Error('AN-09b not implemented');
}
