import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionOutcome } from './outcome.ts';
import { moveNear } from './pathing.ts';
import { bed, type FakeOptions, fakeBot, sleep } from './sleep.fakes.ts';
import { sleepFailure } from './sleep.ts';
import { bedRefusalFact, watchBedRefusal } from './sleep-refusal.ts';

vi.mock('./pathing.ts', () => ({
  moveNear: vi.fn(async () => ({ ok: true, distance: 0 })),
}));

beforeEach(() => {
  vi.mocked(moveNear).mockClear();
});

const BED_PREFIX = 'block.minecraft.bed.';
const NOT_SAFE = `${BED_PREFIX}not_safe`;
/** A server text the Body's generic sleep error matches (the `cant click` class of decision 0224). */
const GENERIC = 'cant click the bed';
/** The generic text the agent reads when no bed key says more. */
const COULD_NOT_BE_USED = 'the bed could not be used';
/** A night time of day, so the action reaches the bed loop. */
const NIGHT = 13_000;
/** A zombie, id 1, six blocks east of the bed head (5, 64, 0): counted by the bed box. */
const ZOMBIE = { id: 1, name: 'zombie', position: new Vec3(11, 64, 0) };

/** A sink that drops its lines. */
const QUIET_SINK = { log: () => undefined, now: () => 0 };

/** The record a failed outcome carries in `raw`, parsed; empty when there is none. */
function rawOf(outcome: ActionOutcome): Record<string, unknown> {
  return outcome.status === 'failed' && outcome.raw ? JSON.parse(outcome.raw) : {};
}

/**
 * Sends one action-bar line the way mineflayer 4.39 does: a prismarine-chat message as arg 1 (its `translate` and
 * `json.translate`), the position as arg 2 and a null sender as arg 3. A line with no key has neither.
 */
function emitKey(bot: Bot, key: string | undefined, position = 'game_info'): void {
  const message =
    key === undefined
      ? { json: { text: 'no key here' }, toString: () => 'no key here' }
      : { json: { translate: key }, translate: key, toString: () => key };
  (bot as unknown as { emit: (...args: unknown[]) => boolean }).emit(
    'message',
    message,
    position,
    null,
  );
}

/** Runs a night sleep in one bed whose server refuses with `GENERIC`; each `[ms, key]` is sent to the bot at `ms`. */
function refuse(schedule: [number, string][], options: Partial<FakeOptions> = {}) {
  const bot = fakeBot({
    timeOfDay: NIGHT,
    blocks: bed('white_bed', 5),
    sleepErrors: [GENERIC],
    ...options,
  });
  const outcome = sleep(bot);
  for (const [ms, key] of schedule) setTimeout(() => emitKey(bot, key), ms);
  return { bot, outcome };
}

describe('bedRefusalFact: the five server keys', () => {
  it.each([
    ['no_sleep', false, 'it is not night', 'not_possible'],
    ['not_safe', false, 'the server says there are monsters nearby; none in view', 'not_possible'],
    ['too_far_away', false, 'the bed is too far away', 'out_of_reach'],
    ['occupied', false, 'the bed is occupied', 'blocked'],
    ['obstructed', false, 'the bed is obstructed', 'blocked'],
  ])('%s maps to its text and reason', (name, counted, text, reason) => {
    expect(bedRefusalFact(`${BED_PREFIX}${name}`, counted)).toEqual({ text, reason });
  });

  it('not_safe with a counted hostile has no fact of its own: the named-hostile text is used', () => {
    expect(bedRefusalFact(NOT_SAFE, true)).toBeUndefined();
  });

  it('an unknown bed key has no fact', () => {
    expect(bedRefusalFact(`${BED_PREFIX}something_new`, false)).toBeUndefined();
  });
});

describe('watchBedRefusal', () => {
  it('keeps the newest bed key once armed, ignores other lines, and stops', () => {
    const bot = fakeBot();
    const watch = watchBedRefusal(bot);
    emitKey(bot, `${BED_PREFIX}occupied`);
    expect(watch.latest()).toBeUndefined();
    watch.arm();
    emitKey(bot, `${BED_PREFIX}occupied`);
    emitKey(bot, NOT_SAFE);
    emitKey(bot, 'sleep.skipping_night');
    emitKey(bot, undefined);
    emitKey(bot, `${BED_PREFIX}too_far_away`, 'chat');
    expect(watch.latest()).toBe(NOT_SAFE);
    watch.arm();
    expect(watch.latest()).toBeUndefined();
    watch.stop();
    watch.stop();
    expect(bot.listenerCount('message')).toBe(0);
  });
});

describe('watchBedRefusal reads the real message shape', () => {
  /** Emits arg 1 as given, with `game_info` and a null sender (the shape mineflayer 4.39 sends). */
  function emitShape(bot: Bot, message: unknown): void {
    (bot as unknown as { emit: (...args: unknown[]) => boolean }).emit(
      'message',
      message,
      'game_info',
      null,
    );
  }

  it('reads the key from json.translate alone', () => {
    const bot = fakeBot();
    const watch = watchBedRefusal(bot);
    watch.arm();
    emitShape(bot, { json: { translate: NOT_SAFE }, toString: () => NOT_SAFE });
    expect(watch.latest()).toBe(NOT_SAFE);
    watch.stop();
  });

  it('ignores a message with neither translate nor json.translate', () => {
    const bot = fakeBot();
    const watch = watchBedRefusal(bot);
    watch.arm();
    emitShape(bot, { json: { text: 'hello' }, toString: () => 'hello' });
    emitShape(bot, { toString: () => 'hello' });
    expect(watch.latest()).toBeUndefined();
    watch.stop();
  });
});

describe('bed refusal lines in sleep()', () => {
  it('a key that arrives before the error is used, with no wait for a second key', async () => {
    // Mineflayer's generic refusal settles 3 s after the click, so the server's key is already in hand.
    const { outcome } = refuse([[20, `${BED_PREFIX}no_sleep`]], { sleepDelayMs: 100 });
    expect(await outcome).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: 'it is not night',
    });
  });

  it('the loop failure keeps the last refused bed key in raw (bed_key reaches the action log)', async () => {
    const { outcome } = refuse([[20, `${BED_PREFIX}occupied`]]);
    const result = await outcome;
    expect(result).toMatchObject({ status: 'failed', reason: 'blocked' });
    expect(rawOf(result)).toMatchObject({ bed_key: `${BED_PREFIX}occupied` });
  });

  it('no_sleep reads as "it is not night", not_possible', async () => {
    const { outcome } = refuse([[20, `${BED_PREFIX}no_sleep`]]);
    expect(await outcome).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: 'it is not night',
    });
  });

  it('not_safe with no hostile in view reads as the server says, not_possible', async () => {
    const { outcome } = refuse([[20, NOT_SAFE]]);
    expect(await outcome).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: 'the server says there are monsters nearby; none in view',
    });
  });

  it('not_safe with a counted zombie names the zombie (the monsters path)', async () => {
    const { outcome } = refuse([[20, NOT_SAFE]], { entities: [ZOMBIE] });
    const result = await outcome;
    expect(result).toMatchObject({ status: 'failed', reason: 'not_possible' });
    expect(result.status === 'failed' && result.message).toMatch(/zombie/);
  });

  it('occupied is blocked and the loop reports it as the last bed text', async () => {
    const { outcome } = refuse([[20, `${BED_PREFIX}occupied`]]);
    const result = await outcome;
    expect(result).toMatchObject({ status: 'failed', reason: 'blocked' });
    expect(result.status === 'failed' && result.message).toContain('last: the bed is occupied');
  });

  it('too_far_away is out_of_reach; the other half gets its own key', async () => {
    // Two refusals: the bed, then its other half (the second one the server refuses too).
    const { outcome } = refuse(
      [
        [20, `${BED_PREFIX}too_far_away`],
        [150, `${BED_PREFIX}too_far_away`],
      ],
      { sleepErrors: [GENERIC, GENERIC] },
    );
    expect(await outcome).toMatchObject({
      status: 'failed',
      reason: 'out_of_reach',
      message: 'the bed is too far away',
    });
  });

  it('a generic refusal with no key keeps "the bed could not be used"', async () => {
    const outcome = await refuse([]).outcome;
    expect(outcome).toMatchObject({ status: 'failed', reason: 'blocked' });
    expect(outcome.status === 'failed' && outcome.message).toContain(COULD_NOT_BE_USED);
  });

  it('a generic refusal with no key has no bed_key in raw', () => {
    const outcome = sleepFailure(GENERIC, QUIET_SINK);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: COULD_NOT_BE_USED,
    });
    expect(rawOf(outcome)).not.toHaveProperty('bed_key');
  });

  it('an unknown bed key keeps "the bed could not be used" and records bed_key in raw', () => {
    const key = `${BED_PREFIX}something_new`;
    const outcome = sleepFailure(GENERIC, QUIET_SINK, undefined, key);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: COULD_NOT_BE_USED,
    });
    expect(rawOf(outcome)).toMatchObject({ bed_key: key });
  });

  it('a known key on a non-generic refusal is recorded in raw and does not change the text', () => {
    const outcome = sleepFailure('Bed is occupied', QUIET_SINK, undefined, `${BED_PREFIX}occupied`);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'the bed is occupied',
    });
    expect(rawOf(outcome)).toMatchObject({ bed_key: `${BED_PREFIX}occupied` });
  });

  it('a key that arrives after the 300 ms wait is not used', async () => {
    const outcome = await refuse([[450, `${BED_PREFIX}no_sleep`]]).outcome;
    expect(outcome.status === 'failed' && outcome.message).toContain(COULD_NOT_BE_USED);
  });

  it('the watcher stops on success', async () => {
    const bot = fakeBot({ timeOfDay: NIGHT, blocks: bed('white_bed', 5) });
    expect(await sleep(bot)).toMatchObject({ status: 'completed' });
    expect(bot.listenerCount('message')).toBe(0);
  });

  it('the watcher stops on failure', async () => {
    const { bot, outcome } = refuse([[20, NOT_SAFE]]);
    await outcome;
    expect(bot.listenerCount('message')).toBe(0);
  });

  it('the watcher stops on cancel', async () => {
    const bot = fakeBot({ timeOfDay: NIGHT, blocks: bed('white_bed', 5), hangSleep: true });
    const controller = new AbortController();
    const outcome = sleep(bot, 1, controller.signal);
    setTimeout(() => controller.abort(), 30);
    expect(await outcome).toMatchObject({ status: 'cancelled' });
    expect(bot.listenerCount('message')).toBe(0);
  });
});
