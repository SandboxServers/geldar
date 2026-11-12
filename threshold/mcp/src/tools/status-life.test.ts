import { describe, expect, it } from 'vitest';
import { FakeBudgetLedger } from '../fakes/stores.fakes.ts';
import type { AgentProfiles, DeathMarks, SleepMarks } from '../ports.ts';
import { type StatusDeps, statusTool } from './status.ts';

const LIFE = 'ag_jason_01';
const NOW = 1_000_000;
const BORN = 1;

/** A death store that counts each death event id once, as the Pg store does (migration 0023). */
class DeathLedger implements DeathMarks {
  private readonly seen = new Set<string>();
  private deaths = 0;
  private lastDeathDay: number | null = null;

  async read() {
    return { deaths: this.deaths, lastDeathDay: this.lastDeathDay };
  }

  async recordDeath(_lifeId: string, eventId: string, day: number) {
    if (this.seen.has(eventId)) return;
    this.seen.add(eventId);
    this.deaths++;
    this.lastDeathDay = day;
  }
}

/** A status call on world `day` for a life with the given death store. */
async function status(day: number, deaths: DeathMarks) {
  const budget = new FakeBudgetLedger(0, 10);
  budget.seed(LIFE, 10, NOW);
  const profiles: AgentProfiles = {
    profile: async () => ({ born_day: BORN, personality_seed: '' }),
  };
  const sleeps: SleepMarks = {
    read: async () => ({ lastSleepDay: BORN, cursor: 0 }),
    write: async () => {},
  };
  const body = { snapshot: async () => ({ world_time: { day } }) };
  const deps: StatusDeps = {
    body: body as never,
    budget,
    profiles,
    sleeps,
    deaths,
    laws: [],
    now: () => NOW,
  };
  return statusTool(deps, { lifeId: LIFE } as never);
}

describe('status: the life and the days alive in it', () => {
  it('reports life 1 and the days since birth when the life has had no death', async () => {
    const result = await status(10, new DeathLedger());
    expect(result.life).toBe(1);
    expect(result.days_alive_this_life).toBe(9);
    expect(result.days_alive).toBe(9);
  });

  it('reports life 2 after one death, and counts days alive from the death day', async () => {
    const deaths = new DeathLedger();
    await deaths.recordDeath(LIFE, 'ev_1', 4);
    const result = await status(10, deaths);
    expect(result.life).toBe(2);
    expect(result.days_alive_this_life).toBe(6);
    expect(result.days_alive).toBe(9);
  });

  it('counts the life from the last of two deaths, so the days alive reset again', async () => {
    const deaths = new DeathLedger();
    await deaths.recordDeath(LIFE, 'ev_1', 4);
    await deaths.recordDeath(LIFE, 'ev_2', 8);
    const result = await status(10, deaths);
    expect(result.life).toBe(3);
    expect(result.days_alive_this_life).toBe(2);
  });

  it('counts a repeated death event once: the life does not move on a redelivery', async () => {
    const deaths = new DeathLedger();
    await deaths.recordDeath(LIFE, 'ev_1', 4);
    await deaths.recordDeath(LIFE, 'ev_1', 4);
    const result = await status(10, deaths);
    expect(result.life).toBe(2);
    expect(result.days_alive_this_life).toBe(6);
  });

  it('never reports negative days alive in a life when the death day is ahead of the clock', async () => {
    const deaths = new DeathLedger();
    await deaths.recordDeath(LIFE, 'ev_1', 12);
    const result = await status(10, deaths);
    expect(result.days_alive_this_life).toBe(0);
  });

  it('fails the status call when the death store fails, rather than reporting life 1', async () => {
    const broken: DeathMarks = {
      read: async () => {
        throw new Error('db down');
      },
      recordDeath: async () => {},
    };
    await expect(status(10, broken)).rejects.toThrow('db down');
  });
});
