import type { SpeechIdentity } from '@geldar/animus/src/attention/classify.ts';
import { eventOf } from '@geldar/animus/src/link/link.fixtures.ts';
import { describe, expect, it } from 'vitest';
import type { DeathMarks } from '../ports.ts';
import { RingEventLog } from './player-log.ts';
import { handleStreamMessage } from './stream.ts';

function context(deaths: Pick<DeathMarks, 'recordDeath'>) {
  return {
    map: { identity: {} as SpeechIdentity, runs: new Map() },
    log: new RingEventLog(),
    lives: () => [],
    deaths,
  };
}

function recorder() {
  const calls: string[] = [];
  return {
    calls,
    deaths: {
      recordDeath: async (lifeId: string, eventId: string) => {
        calls.push(`${lifeId}:${eventId}`);
      },
    },
  };
}

describe('stream: death events reach the death count', () => {
  it('records a death event with its life and event id, once per message', async () => {
    const { calls, deaths } = recorder();
    const raw = { ...eventOf('death', 5), payload: { cause: 'FALL' } };
    const counters = { invalid: 0 };
    await handleStreamMessage(1, raw, context(deaths), counters);
    expect(calls).toHaveLength(1);
    expect(counters.invalid).toBe(0);
  });

  it('records nothing for a message that is not a death', async () => {
    const { calls, deaths } = recorder();
    const raw = { ...eventOf('day_night', 5, null), payload: { phase: 'day', tick: 5 } };
    await handleStreamMessage(2, raw, context(deaths), { invalid: 0 });
    expect(calls).toEqual([]);
  });
});
