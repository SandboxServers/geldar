import type { SpeechIdentity } from '@geldar/animus/src/attention/classify.ts';
import { eventOf } from '@geldar/animus/src/link/link.fixtures.ts';
import { describe, expect, it } from 'vitest';
import { RingEventLog } from './player-log.ts';
import { handleStreamMessage, replayStartIso, streamSubjects } from './stream.ts';

const LIVES = ['ag_jason_01', 'ag_mira_01'];
const dayNight = (phase: string, tick: number) => ({
  ...eventOf('day_night', 5, null),
  payload: { phase, tick },
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
    const call = { ...eventOf('sovereign_call', 3, null), payload: {} };
    await handleStreamMessage(3, call, context(log), counters);
    expect(counters.invalid).toBe(2);
    expect((await log.since(LIVES[0] as string, 0)).events).toEqual([]);
  });

  it('never throws on a non-object message, and counts it', async () => {
    const log = new RingEventLog();
    const counters = { invalid: 0 };
    for (const raw of [null, undefined, 42, [], { type: 7 }]) {
      await expect(handleStreamMessage(1, raw, context(log), counters)).resolves.toBeUndefined();
    }
    expect(counters.invalid).toBe(5);
  });

  it('drops a day_night event whose envelope or payload is not the contract shape', async () => {
    const log = new RingEventLog();
    const counters = { invalid: 0 };
    const { source_event_id: _id, ...noId } = dayNight('dusk', 9);
    await handleStreamMessage(1, noId, context(log), counters);
    await handleStreamMessage(2, { ...dayNight('dusk', 9), extra: true }, context(log), counters);
    await handleStreamMessage(3, dayNight('dusk', -1), context(log), counters);
    await handleStreamMessage(
      4,
      { ...dayNight('dusk', 9), payload: { phase: 'dusk', tick: 9, x: 1 } },
      context(log),
      counters,
    );
    expect(counters.invalid).toBe(4);
    for (const life of LIVES) expect((await log.since(life, 0)).events).toEqual([]);
  });

  it('drops a Mind event whose payload fails its contract schema, and appends nothing', async () => {
    const log = new RingEventLog();
    const counters = { invalid: 0 };
    const badSpeech = { ...eventOf('speech', 7, LIVES[0]), payload: { text: 'hi' } };
    await handleStreamMessage(7, badSpeech, context(log), counters);
    expect(counters.invalid).toBe(1);
    expect((await log.since(LIVES[0] as string, 0)).events).toEqual([]);
  });

  it('drops an event whose envelope type is not a contract type name', async () => {
    const log = new RingEventLog();
    const counters = { invalid: 0 };
    await handleStreamMessage(
      8,
      { ...eventOf('speech', 8, LIVES[0]), type: 'Speech!' },
      context(log),
      counters,
    );
    expect(counters.invalid).toBe(1);
    expect((await log.since(LIVES[0] as string, 0)).events).toEqual([]);
  });

  it('subscribes to no subject the Body answers on (snapshot, plan, book)', () => {
    const subjects = streamSubjects('phase0');
    for (const kind of ['snapshot', 'plan', 'book']) {
      expect(subjects).not.toContain(`geldar.phase0.${kind}`);
    }
    expect(subjects).toHaveLength(11);
  });
});
