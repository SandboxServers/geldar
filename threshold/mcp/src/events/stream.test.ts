import type { SpeechIdentity } from '@geldar/animus/src/attention/classify.ts';
import { describe, expect, it } from 'vitest';
import { RingEventLog } from './player-log.ts';
import { handleStreamMessage, replayStartIso, streamSubjects } from './stream.ts';

const LIVES = ['ag_jason_01', 'ag_mira_01'];
const dayNight = (phase: string, tick: number) => ({
  type: 'day_night',
  payload: { phase, tick },
  at: '1970-01-01T00:10:00.000Z',
});

function context(log: RingEventLog) {
  return {
    // The day_night path never reads the identity.
    map: { identity: {} as SpeechIdentity, runs: new Map() },
    log,
    lives: () => LIVES,
  };
}

describe('stream', () => {
  it('subscribes to the Mind subjects plus sovereign_call and day_night', () => {
    const subjects = streamSubjects('phase0');
    expect(subjects).toContain('geldar.phase0.speech');
    expect(subjects).toContain('geldar.phase0.sovereign_call');
    expect(subjects).toContain('geldar.phase0.day_night');
  });

  it('starts the replay replay_minutes before now', () => {
    expect(replayStartIso(10 * 60_000, 5)).toBe(new Date(5 * 60_000).toISOString());
  });

  it('fans a day_night event out to every life once, even when it is redelivered', async () => {
    const log = new RingEventLog();
    const counters = { invalid: 0 };
    await handleStreamMessage(5, dayNight('dusk', 12000), context(log), counters);
    await handleStreamMessage(5, dayNight('dusk', 12000), context(log), counters);
    for (const life of LIVES) {
      const { events } = await log.since(life, 0);
      expect(events.map((e) => [e.seq, e.kind, e.name])).toEqual([[5, 'day_night', 'dusk']]);
    }
    expect(counters.invalid).toBe(0);
  });

  it('counts and drops an invalid message, and skips sovereign_call', async () => {
    const log = new RingEventLog();
    const counters = { invalid: 0 };
    await handleStreamMessage(1, 'garbage', context(log), counters);
    await handleStreamMessage(2, dayNight('noon', 1), context(log), counters);
    await handleStreamMessage(3, { type: 'sovereign_call', payload: {} }, context(log), counters);
    expect(counters.invalid).toBe(2);
    expect((await log.since(LIVES[0] as string, 0)).events).toEqual([]);
  });
});
