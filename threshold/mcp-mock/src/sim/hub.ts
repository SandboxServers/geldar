import { makeId } from '../ids.ts';
import type { Clock } from './clock.ts';
import { PlayerSim } from './player-sim.ts';
import type { Scenario } from './scenario.ts';
import type { WakeConfig } from './wake.ts';

/** How many suppressed-wake records the hub keeps per player. */
const SUPPRESSED_LIMIT = 1000;
/** How much journal text a player keeps. */
export const JOURNAL_LIMIT = 8192;

/** One wake that did not happen, with the reason (spec 5.3.2). */
export interface SuppressedRecord {
  player_id: string;
  seq: number;
  kind: string;
  reason: string;
  at_ms: number;
  tick: number;
}

/** What `SimHub` is built from. */
export interface SimHubInit {
  scenario: Scenario;
  clock: Clock;
  /** Called for every new suppressed-wake record. */
  onSuppressed?: (record: SuppressedRecord) => void;
}

/** Per-player state that is not part of the world sim: journal, sleep mark and counters. */
export interface PlayerLife {
  /** The player's journal, the last 8192 characters. */
  journal: string;
  /** The log seq at the last `sleep`; the next `sleep` reports events after it. */
  sleepMark: number;
  /** The world day of the last `sleep` (the birth day before the first). */
  lastSleepDay: number;
}

/** What the tools read: how often to poll, and the wake timings. */
export interface HubConfig {
  pollMs: number;
  wake: WakeConfig;
}

/** The mock world: one `PlayerSim` per player, all on one clock and one scenario. */
export class SimHub {
  readonly scenario: Scenario;
  readonly clock: Clock;
  readonly config: HubConfig;
  private readonly onSuppressed: ((record: SuppressedRecord) => void) | undefined;
  private readonly sims = new Map<string, PlayerSim>();
  private readonly lives = new Map<string, PlayerLife>();
  private readonly records = new Map<string, SuppressedRecord[]>();

  /** Reads the wake timings from the scenario. */
  constructor(init: SimHubInit) {
    this.scenario = init.scenario;
    this.clock = init.clock;
    this.onSuppressed = init.onSuppressed;
    this.config = {
      pollMs: 1000,
      wake: {
        minSpacingMs: init.scenario.wake.min_spacing_seconds * 1000,
        intentRunTooLongMs: init.scenario.wake.intent_run_too_long_seconds * 1000,
      },
    };
  }

  /**
   * The player's sim, created at the current clock time on first use and always synced to the
   * current time, so no tool reads stale state.
   */
  player(playerId: string): PlayerSim {
    let sim = this.sims.get(playerId);
    if (!sim) {
      const counters = new Map<string, number>();
      sim = new PlayerSim({
        scenario: this.scenario,
        startMs: this.clock.nowMs(),
        nextId: (prefix) => {
          const n = (counters.get(prefix) ?? 0) + 1;
          counters.set(prefix, n);
          return makeId(prefix, n);
        },
      });
      this.sims.set(playerId, sim);
    }
    sim.syncTo(this.clock.nowMs());
    return sim;
  }

  /** The player's journal, sleep mark and last sleep day. */
  life(playerId: string): PlayerLife {
    let life = this.lives.get(playerId);
    if (!life) {
      life = { journal: '', sleepMark: 0, lastSleepDay: this.scenario.character.born_day };
      this.lives.set(playerId, life);
    }
    return life;
  }

  /** The player's suppressed-wake records, oldest first (the last 1000). */
  suppressed(playerId: string): SuppressedRecord[] {
    return [...(this.records.get(playerId) ?? [])];
  }

  /** Stores one record and tells the observer. */
  recordSuppressed(record: SuppressedRecord): void {
    const list = this.records.get(record.player_id) ?? [];
    list.push(record);
    if (list.length > SUPPRESSED_LIMIT) list.splice(0, list.length - SUPPRESSED_LIMIT);
    this.records.set(record.player_id, list);
    this.onSuppressed?.(record);
  }
}
