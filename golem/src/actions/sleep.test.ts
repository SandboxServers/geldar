import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { moveNear } from './pathing.ts';
import { BED, bed, fakeBot, OTHER_HALF, sleep } from './sleep.fakes.ts';
import { classifySleepError, isNightOrStorm, sleepErrorText, sleepFailure } from './sleep.ts';

vi.mock('./pathing.ts', () => ({
  moveNear: vi.fn(async () => ({ ok: true, distance: 0 })),
}));

beforeEach(() => {
  vi.mocked(moveNear).mockClear();
});

describe('isNightOrStorm', () => {
  it('is true from the start to the end of the night window', () => {
    expect(isNightOrStorm(12_541, false)).toBe(false);
    expect(isNightOrStorm(12_542, false)).toBe(true);
    expect(isNightOrStorm(23_459, false)).toBe(true);
    expect(isNightOrStorm(23_460, false)).toBe(false);
  });

  it('is true in a thunderstorm by day', () => {
    expect(isNightOrStorm(1_000, true)).toBe(true);
  });
});

describe('classifySleepError', () => {
  it('maps each Mineflayer error text to its reason', () => {
    expect(classifySleepError('There are monsters nearby')).toBe('not_possible');
    expect(classifySleepError('You are too far away')).toBe('out_of_reach');
    expect(classifySleepError('Bed is occupied')).toBe('blocked');
    expect(classifySleepError('Not a bed')).toBe('not_found');
    expect(classifySleepError('only half bed')).toBe('not_found');
    expect(classifySleepError('not sleeping')).toBe('blocked');
    expect(classifySleepError('cant click that')).toBe('blocked');
    expect(classifySleepError('not night')).toBe('not_possible');
    expect(classifySleepError('You are already sleeping')).toBe('not_possible');
    expect(classifySleepError('something else')).toBe('not_possible');
  });

  it('maps the Mineflayer and server texts of each failure to its reason', () => {
    expect(classifySleepError('You may not rest now; there are monsters nearby')).toBe(
      'not_possible',
    );
    expect(classifySleepError("it's not night and it's not a thunderstorm")).toBe('not_possible');
    expect(classifySleepError('You can only sleep at night or during a thunderstorm')).toBe(
      'not_possible',
    );
    expect(classifySleepError('the bed is too far')).toBe('out_of_reach');
    expect(classifySleepError('the bed is occupied')).toBe('blocked');
    expect(classifySleepError('This bed is obstructed')).toBe('blocked');
  });
});

describe('sleepFailure: an unknown sleep text (batch 14)', () => {
  it('reads an unrecognised server text as not_possible, keeps the text and logs it', () => {
    const lines: string[] = [];
    const outcome = sleepFailure('Server says no thanks', {
      log: (line) => lines.push(line),
      now: () => 0,
    });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: 'Server says no thanks',
    });
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { event: 'sleep_reason_unknown', message: 'Server says no thanks' },
    ]);
  });

  it('a known sleep text keeps its reason and logs nothing', () => {
    const lines: string[] = [];
    const outcome = sleepFailure('Bed is occupied', {
      log: (line) => lines.push(line),
      now: () => 0,
    });
    expect(outcome).toMatchObject({ reason: 'blocked', message: 'the bed is occupied' });
    expect(lines).toEqual([]);
  });
});

describe('sleepErrorText', () => {
  it('states the fact each known failure reports, in plain words', () => {
    expect(sleepErrorText('There are monsters nearby')).toBe(
      'there are monsters nearby: none in view',
    );
    expect(sleepErrorText('You may not rest now; there are monsters nearby')).toBe(
      'there are monsters nearby: none in view',
    );
    expect(sleepErrorText("it's not night and it's not a thunderstorm")).toBe('it is not night');
    expect(sleepErrorText('You can only sleep at night or during a thunderstorm')).toBe(
      'it is not night',
    );
    expect(sleepErrorText('the bed is too far')).toBe('the bed is too far away');
    expect(sleepErrorText('You are too far away')).toBe('the bed is too far away');
    expect(sleepErrorText('the bed is occupied')).toBe('the bed is occupied');
    expect(sleepErrorText('This bed is occupied')).toBe('the bed is occupied');
    expect(sleepErrorText('This bed is obstructed')).toBe('the bed is obstructed');
  });

  it('keeps the message as it came when no fact is known', () => {
    expect(sleepErrorText('wrong block : not a bed block')).toBe('wrong block : not a bed block');
    expect(sleepErrorText('something else')).toBe('something else');
  });
});

describe('sleep', () => {
  it('fails with not_found when there is no bed', async () => {
    const outcome = await sleep(fakeBot({ timeOfDay: 13_000, blocks: [] }));
    expect(outcome).toMatchObject({ status: 'failed', reason: 'not_found', message: 'no bed' });
  });

  it('by day fails with not_possible and never calls bot.sleep', async () => {
    const bot = fakeBot({ timeOfDay: 1_000, blocks: [{ ...BED }] });
    const outcome = await sleep(bot);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'not_possible' });
    expect(bot.sleep).not.toHaveBeenCalled();
  });

  it('at night walks to the bed and completes asleep', async () => {
    const bot = fakeBot({ timeOfDay: 13_000, blocks: [{ ...BED }] });
    const outcome = await sleep(bot);
    expect(outcome).toEqual({ status: 'completed', detail: { bed: { x: 5, y: 64, z: 0 } } });
    expect(moveNear).toHaveBeenCalledWith(
      bot,
      BED.position,
      1,
      expect.objectContaining({ timeScale: 1 }),
    );
    expect(bot.isSleeping).toBe(true);
  });

  it('retries on the other half of the bed after out_of_reach', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [{ ...BED }, { ...OTHER_HALF }],
      sleepErrors: ['You are too far away'],
    });
    const outcome = await sleep(bot);
    expect(outcome).toEqual({ status: 'completed', detail: { bed: { x: 6, y: 64, z: 0 } } });
    expect(moveNear).toHaveBeenNthCalledWith(2, bot, OTHER_HALF.position, 1, expect.anything());
    expect(bot.sleep).toHaveBeenCalledTimes(2);
  });

  /** Runs the bed loop on a fake clock: each walk advances it by `walkMs`. Returns the outcome and the bot. */
  async function sleepWithClock(walkMs: number, timeScale = 1) {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const slowWalk = async () => {
      now += walkMs;
      return { ok: true, distance: 0 };
    };
    vi.mocked(moveNear).mockImplementation(slowWalk as never);
    const beds = [5, 9, 13, 17, 21, 25].flatMap((x) => bed('white_bed', x));
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: beds,
      sleepErrors: Array(6).fill('Bed is occupied'),
    });
    try {
      return { outcome: await sleep(bot, timeScale), bot };
    } finally {
      clock.mockRestore();
      vi.mocked(moveNear).mockImplementation(async () => ({ ok: true, distance: 0 }) as never);
    }
  }

  it('stops the bed loop after the 30 s budget and says the search time ran out', async () => {
    // Each walk takes 12 s on a fake clock, so the budget ends the loop after the third bed.
    const { outcome, bot } = await sleepWithClock(12_000);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: expect.stringMatching(/^tried 3 of 6 nearby beds; the search time ran out; last: /),
    });
    expect(bot.sleep).toHaveBeenCalledTimes(3);
    expect(moveNear).toHaveBeenCalledTimes(3);
  });

  it('starts a bed at exactly the budget boundary: 30 s spent stops the loop', async () => {
    // Each walk takes 10 s, so the third bed is started at 20 s and the fourth at exactly 30 s.
    const { outcome, bot } = await sleepWithClock(10_000);
    expect(outcome).toMatchObject({
      status: 'failed',
      message: expect.stringMatching(/^tried 3 of 6 nearby beds; the search time ran out/),
    });
    expect(bot.sleep).toHaveBeenCalledTimes(3);
  });

  it('scales the budget by the time scale: at 0.5 the search stops at 15 s', async () => {
    // Each walk takes 12 s: the second bed starts at 12 s (under 15 s), the third at 24 s (over).
    const { outcome, bot } = await sleepWithClock(12_000, 0.5);
    expect(outcome).toMatchObject({
      status: 'failed',
      message: expect.stringMatching(/^tried 2 of 6 nearby beds; the search time ran out/),
    });
    expect(bot.sleep).toHaveBeenCalledTimes(2);
  });

  it('is completed without a bed call when the bot is already asleep', async () => {
    const bot = fakeBot({ timeOfDay: 13_000, blocks: [{ ...BED }], asleep: true });
    const outcome = await sleep(bot);
    expect(outcome.status).toBe('completed');
    expect(bot.sleep).not.toHaveBeenCalled();
    expect(moveNear).not.toHaveBeenCalled();
  });

  it('treats an already-sleeping rejection as asleep, not a failure', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [{ ...BED }],
      sleepErrors: ['You are already sleeping'],
    });
    const outcome = await sleep(bot);
    expect(outcome.status).toBe('completed');
    expect(bot.sleep).toHaveBeenCalledTimes(1);
  });

  it('sleeps in the second bed when the first is occupied', async () => {
    const far = { name: 'red_bed', position: new Vec3(9, 64, 0) };
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [{ ...BED }, far],
      sleepErrors: ['Bed is occupied'],
    });
    const outcome = await sleep(bot);
    expect(outcome).toEqual({ status: 'completed', detail: { bed: { x: 9, y: 64, z: 0 } } });
    expect(bot.sleep).toHaveBeenCalledTimes(2);
    expect(moveNear).toHaveBeenLastCalledWith(bot, far.position, 1, expect.anything());
  });

  it('names the bed as not usable, not the raw click error, when every bed refuses the click', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [{ ...BED }, { ...OTHER_HALF, name: 'red_bed' }],
      sleepErrors: ['cant click the bed', 'cant click the bed'],
    });
    const outcome = await sleep(bot);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'blocked' });
    expect(outcome.status === 'failed' && outcome.message).toBe(
      'tried 2 nearby beds, all occupied or blocked; last: the bed could not be used',
    );
    expect(classifySleepError('cant click the bed')).toBe('blocked');
  });

  it('is blocked, naming the count tried, when every nearby bed is occupied', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [{ ...BED }, { ...OTHER_HALF, name: 'red_bed' }],
      sleepErrors: ['Bed is occupied', 'Bed is occupied'],
    });
    const outcome = await sleep(bot);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'blocked' });
    expect(outcome.status === 'failed' && outcome.message).toBe(
      'tried 2 nearby beds, all occupied or blocked; last: the bed is occupied',
    );
    expect(bot.sleep).toHaveBeenCalledTimes(2);
  });

  it('tries at most eight beds', async () => {
    const blocks = Array.from({ length: 10 }, (_, i) => bed('white_bed', i * 3)).flat();
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks,
      sleepErrors: Array.from({ length: 10 }, () => 'Bed is occupied'),
    });
    const outcome = await sleep(bot);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'blocked' });
    expect(outcome.status === 'failed' && outcome.message).toContain('tried 8');
    expect(bot.sleep).toHaveBeenCalledTimes(8);
  });

  it('counts a two-block bed once when it is occupied', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: bed('white_bed', 5),
      sleepErrors: ['Bed is occupied'],
    });
    const outcome = await sleep(bot);
    expect(outcome.status === 'failed' && outcome.message).toContain('tried 1 nearby beds');
    expect(bot.sleep).toHaveBeenCalledTimes(1);
  });

  it('reaches a free sixth bed after five occupied ones, each made of two blocks', async () => {
    const blocks = Array.from({ length: 6 }, (_, i) => bed('white_bed', i * 3)).flat();
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks,
      sleepErrors: Array.from({ length: 5 }, () => 'Bed is occupied'),
    });
    const outcome = await sleep(bot);
    expect(outcome).toEqual({ status: 'completed', detail: { bed: { x: 15, y: 64, z: 0 } } });
    expect(bot.sleep).toHaveBeenCalledTimes(6);
  });

  it('tries the second bed when the walk to the first times out', async () => {
    const far = { name: 'red_bed', position: new Vec3(9, 64, 0) };
    vi.mocked(moveNear).mockResolvedValueOnce({
      ok: false,
      reason: 'timeout',
      message: 'the path search ran out of time',
    });
    const bot = fakeBot({ timeOfDay: 13_000, blocks: [{ ...BED }, far] });
    const outcome = await sleep(bot);
    expect(outcome).toEqual({ status: 'completed', detail: { bed: { x: 9, y: 64, z: 0 } } });
    expect(moveNear).toHaveBeenCalledTimes(2);
    expect(bot.sleep).toHaveBeenCalledTimes(1);
  });

  it('stops at a non-blocked failure and does not try the next bed', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [{ ...BED }, { ...OTHER_HALF, name: 'red_bed' }],
      sleepErrors: ['There are monsters nearby'],
    });
    const outcome = await sleep(bot);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'not_possible' });
    expect(bot.sleep).toHaveBeenCalledTimes(1);
  });

  it('maps a monster-nearby rejection to not_possible', async () => {
    const outcome = await sleep(
      fakeBot({
        timeOfDay: 13_000,
        blocks: [{ ...BED }],
        sleepErrors: ['There are monsters nearby'],
      }),
    );
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: 'there are monsters nearby: none in view',
    });
  });

  it('names the zombie 6 blocks from the bed, not the iron golem 4 blocks away', async () => {
    // The bed head is BED.position (5, 64, 0): the zombie is 6 blocks east of it, the golem 4 blocks west.
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [{ ...BED, light: 12 }],
      entities: [
        { name: 'iron_golem', position: new Vec3(1, 64, 0) },
        { name: 'zombie', position: new Vec3(11, 64, 0) },
      ],
      sleepErrors: ['There are monsters nearby'],
    });
    const outcome = await sleep(bot);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: 'there are monsters nearby: zombie 6 blocks away, in range for under a minute',
    });
  });

  it('records the hostiles and the light in the raw record the agent does not read', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [{ ...BED, light: 12 }],
      entities: [{ name: 'zombie', position: new Vec3(11, 64, 0) }],
      sleepErrors: ['There are monsters nearby'],
    });
    const outcome = await sleep(bot);
    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.detail).toMatchObject({
      final_position: { x: 0, y: 64, z: 0 },
      beds_tried: [
        {
          x: 5,
          y: 64,
          z: 0,
          reason: 'there are monsters nearby: zombie 6 blocks away, in range for under a minute',
        },
      ],
    });
    expect(JSON.parse(outcome.raw ?? 'null')).toEqual({
      event: 'sleep_refusal',
      message: 'There are monsters nearby',
      hostiles: [{ kind: 'zombie', blocks: 6 }],
      count: 1,
      light: 12,
      dwell_ticks: 0,
    });
  });

  it('records a null light when the world does not report one, and no hostile in view', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [{ ...BED }],
      sleepErrors: ['There are monsters nearby'],
    });
    const outcome = await sleep(bot);
    expect(outcome.status === 'failed' ? JSON.parse(outcome.raw ?? 'null') : null).toEqual({
      event: 'sleep_refusal',
      message: 'There are monsters nearby',
      hostiles: [],
      count: 0,
      light: null,
    });
  });

  it('keeps the light inside the first 200 characters of a record with five hostiles', async () => {
    // The action log clips the raw record to 200 characters, so the light must come before the hostiles.
    const kind = 'a_long_hostile_kind_name_for_the_clip';
    const hostiles = [1, 2, 3, 4, 5].map((blocks) => ({ kind, blocks }));
    const outcome = sleepFailure(
      'There are monsters nearby',
      { log: () => undefined, now: () => 0 },
      { hostiles, light: 12 },
    );
    expect(outcome.status === 'failed' ? (outcome.raw ?? '').slice(0, 200) : '').toContain(
      '"light":12',
    );
    expect(outcome.status === 'failed' ? JSON.parse(outcome.raw ?? 'null') : null).toEqual({
      event: 'sleep_refusal',
      message: 'There are monsters nearby',
      light: 12,
      hostiles: hostiles.slice(0, 3),
      count: 5,
    });
  });

  it('maps an occupied bed to blocked', async () => {
    const outcome = await sleep(
      fakeBot({ timeOfDay: 13_000, blocks: [{ ...BED }], sleepErrors: ['Bed is occupied'] }),
    );
    expect(outcome).toMatchObject({ status: 'failed', reason: 'blocked' });
  });

  it('is cancelled when the walk is cancelled', async () => {
    vi.mocked(moveNear).mockResolvedValueOnce({
      ok: false,
      reason: 'cancelled',
      message: 'stopped',
    });
    const bot = fakeBot({ timeOfDay: 13_000, blocks: [{ ...BED }] });
    const outcome = await sleep(bot);
    expect(outcome.status).toBe('cancelled');
    expect(bot.sleep).not.toHaveBeenCalled();
  });
});
