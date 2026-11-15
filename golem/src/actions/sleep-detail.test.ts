import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { moveNear } from './pathing.ts';
import { BED, bed, fakeBot, OTHER_HALF, sleep } from './sleep.fakes.ts';

vi.mock('./pathing.ts', () => ({
  moveNear: vi.fn(async () => ({ ok: true, distance: 0 })),
}));

beforeEach(() => {
  vi.mocked(moveNear).mockClear();
});

const MONSTERS = 'There are monsters nearby';
/** A zombie, id 1, six blocks east of the bed head (5, 64, 0): counted by the box. */
const ZOMBIE = { id: 1, name: 'zombie', position: new Vec3(11, 64, 0) };

/** Replaces the bot's entity list, so a test can take a hostile out of the box between two refusals. */
function setEntities(bot: unknown, entities: Record<string, unknown>): void {
  (bot as { entities: Record<string, unknown> }).entities = entities;
}

describe('sleep failure detail: final_position and beds_tried', () => {
  it('the no-bed failure carries the bot position and an empty list of beds', async () => {
    const outcome = await sleep(fakeBot({ timeOfDay: 13_000, blocks: [] }));
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'not_found',
      detail: { final_position: { x: 0, y: 64, z: 0 }, beds_tried: [] },
    });
  });

  it('the tried-all-beds failure lists each bed in the order tried, with its reason', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [{ ...BED }, { ...OTHER_HALF, name: 'red_bed' }],
      sleepErrors: ['Bed is occupied', 'Bed is occupied'],
    });
    // Rounded to one decimal: 0.26 to 0.3, 64.36 to 64.4, -3.96 to -4.
    bot.entity.position = new Vec3(0.26, 64.36, -3.96);
    const outcome = await sleep(bot);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message:
        'tried 2 nearby beds, all occupied or blocked; last: the bed is occupied; ended at 0, 64, -4',
      detail: {
        final_position: { x: 0.3, y: 64.4, z: -4 },
        beds_tried: [
          { x: 5, y: 64, z: 0, reason: 'the bed is occupied' },
          { x: 6, y: 64, z: 0, reason: 'the bed is occupied' },
        ],
      },
    });
  });

  it('the budget failure carries the position and the beds tried before the stop', async () => {
    // Each walk takes 12 s on a fake clock and moves the bot to the bed it walks to.
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.mocked(moveNear).mockImplementation((async (
      walker: { entity: { position: Vec3 } },
      target: Vec3,
    ) => {
      now += 12_000;
      walker.entity.position = new Vec3(target.x, 64, target.z);
      return { ok: true, distance: 0 };
    }) as never);
    const beds = [5, 9, 13, 17, 21, 25].flatMap((x) => bed('white_bed', x));
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: beds,
      sleepErrors: Array(6).fill('Bed is occupied'),
    });
    try {
      const outcome = await sleep(bot);
      expect(outcome).toMatchObject({
        status: 'failed',
        reason: 'blocked',
        message:
          'tried 3 of 6 nearby beds; the search time ran out; last: the bed is occupied; ended at 13, 64, 0',
        detail: {
          final_position: { x: 13, y: 64, z: 0 },
          beds_tried: [
            { x: 5, y: 64, z: 0, reason: 'the bed is occupied' },
            { x: 9, y: 64, z: 0, reason: 'the bed is occupied' },
            { x: 13, y: 64, z: 0, reason: 'the bed is occupied' },
          ],
        },
      });
    } finally {
      clock.mockRestore();
      vi.mocked(moveNear).mockImplementation(async () => ({ ok: true, distance: 0 }) as never);
    }
  });

  it('a monsters refusal stops the loop: one sleep attempt, one bed listed', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [{ ...BED }, { ...OTHER_HALF, name: 'red_bed' }],
      sleepErrors: [MONSTERS, MONSTERS],
    });
    const outcome = await sleep(bot);
    expect(bot.sleep).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: 'there are monsters nearby: none in view',
      detail: {
        final_position: { x: 0, y: 64, z: 0 },
        beds_tried: [{ x: 5, y: 64, z: 0, reason: 'there are monsters nearby: none in view' }],
      },
    });
    expect(outcome.status === 'failed' ? outcome.detail.beds_tried : null).toHaveLength(1);
  });

  it('the longest tried-beds message is cut to 160 characters and still ends with the position', async () => {
    // Eight beds, all occupied: the eighth walk times out with a text too long to fit after the head.
    const blocks = Array.from({ length: 8 }, (_, i) => bed('white_bed', i * 3)).flat();
    for (let i = 0; i < 7; i += 1)
      vi.mocked(moveNear).mockResolvedValueOnce({ ok: true, distance: 0 });
    vi.mocked(moveNear).mockResolvedValueOnce({
      ok: false,
      reason: 'timeout',
      message: `the path search ran out of time ${'x'.repeat(200)}`,
    } as never);
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks,
      sleepErrors: Array(7).fill('Bed is occupied'),
    });
    const outcome = await sleep(bot);
    const message = outcome.status === 'failed' ? outcome.message : '';
    expect(message).toHaveLength(160);
    expect(message).toMatch(
      /^tried 8 nearby beds, all occupied or blocked; last: the path search ran out of time x+\.\.\.; ended at 0, 64, 0$/,
    );
  });
});

describe('monsters refusal: dwell time in the bed box', () => {
  it('says under a minute at the first sighting', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      age: 1_000,
      blocks: [{ ...BED }],
      entities: [ZOMBIE],
      sleepErrors: [MONSTERS],
    });
    const outcome = await sleep(bot);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: 'there are monsters nearby: zombie 6 blocks away, in range for under a minute',
    });
    expect(outcome.status === 'failed' ? JSON.parse(outcome.raw ?? 'null') : null).toMatchObject({
      dwell_ticks: 0,
    });
  });

  it('says 2 minutes for the same entity id 2400 ticks after the first refusal', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      age: 1_000,
      blocks: [{ ...BED }],
      entities: [ZOMBIE],
      sleepErrors: [MONSTERS, MONSTERS],
    });
    await sleep(bot);
    bot.time.age = 3_400;
    const outcome = await sleep(bot);
    expect(outcome).toMatchObject({
      status: 'failed',
      message: 'there are monsters nearby: zombie 6 blocks away, in range for 2 minutes',
    });
    expect(outcome.status === 'failed' ? JSON.parse(outcome.raw ?? 'null') : null).toMatchObject({
      dwell_ticks: 2400,
    });
  });

  it.each([
    [1_199, 'under a minute'],
    [1_200, '1 minute'],
    [2_400, '2 minutes'],
  ])('at %i ticks of dwell says %s', async (ticks, phrase) => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      age: 0,
      blocks: [{ ...BED }],
      entities: [ZOMBIE],
      sleepErrors: [MONSTERS, MONSTERS],
    });
    await sleep(bot);
    bot.time.age = ticks;
    const outcome = await sleep(bot);
    expect(outcome).toMatchObject({
      message: `there are monsters nearby: zombie 6 blocks away, in range for ${phrase}`,
    });
  });

  it('starts the dwell again when the entity id is absent from a refusal box', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      age: 0,
      blocks: [{ ...BED }],
      entities: [ZOMBIE],
      sleepErrors: [MONSTERS, MONSTERS, MONSTERS],
    });
    await sleep(bot);
    bot.time.age = 2_400;
    setEntities(bot, {});
    const absent = await sleep(bot);
    expect(absent).toMatchObject({ message: 'there are monsters nearby: none in view' });
    bot.time.age = 3_000;
    setEntities(bot, { '0': ZOMBIE });
    const back = await sleep(bot);
    expect(back).toMatchObject({
      message: 'there are monsters nearby: zombie 6 blocks away, in range for under a minute',
    });
  });

  it('gives the phrase to the nearest named hostile only', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      age: 0,
      blocks: [{ ...BED }],
      entities: [ZOMBIE],
      sleepErrors: [MONSTERS, MONSTERS],
    });
    await sleep(bot);
    bot.time.age = 1_200;
    setEntities(bot, {
      '0': ZOMBIE,
      '1': { id: 2, name: 'creeper', position: new Vec3(7, 64, 0) },
    });
    const outcome = await sleep(bot);
    // The creeper, 2 blocks away, is first seen now; the zombie's minute is not shown.
    expect(outcome).toMatchObject({
      message:
        'there are monsters nearby: creeper 2 blocks away, in range for under a minute, zombie 6 blocks away',
    });
  });
});
