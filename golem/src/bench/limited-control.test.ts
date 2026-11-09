import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type CommandSource, TestControl } from '../test-control.ts';
import { limitedControl } from './limited-control.ts';

/** A control whose server answers every command with `reply` and records what it was sent. */
function ctlReplying(reply: string) {
  const commands: string[] = [];
  const source: CommandSource = {
    async command(cmd) {
      commands.push(cmd);
      return reply;
    },
  };
  return { ctl: limitedControl(new TestControl(source)), commands };
}

// Replies captured over RCON from the live Paper 26.1.2 server by golem/test/live/limited-probe.live.test.ts:
// `execute if block` on the arena floor (stone_bricks) answers "Test passed" for stone_bricks and
// "Test failed" for stone and bedrock; `data get entity GolemProbe sleeping_pos` answers NO_TAG while
// the bot is awake and ASLEEP in bed, and the lowercase name gets the same reply with the display name.
const PASSED = 'Test passed';
const FAILED = 'Test failed';
const UNLOADED = 'That position is not loaded';
const NO_ENTITY = 'No entity was found';
const NO_TAG = 'Found no elements matching sleeping_pos';
const ASLEEP = 'GolemBench has the following entity data: [I; 1315, 200, 800]';
const ASLEEP_LIVE = 'GolemProbe has the following entity data: [I; 1315, 200, 800]';

describe('limitedControl.blockIs', () => {
  it('sends exactly the execute-if command and parses the reply', async () => {
    const yes = ctlReplying(PASSED);
    expect(await yes.ctl.blockIs(1, 64, -3, 'minecraft:stone')).toBe(true);
    expect(yes.commands).toEqual(['execute if block 1 64 -3 minecraft:stone']);
    expect(await ctlReplying(FAILED).ctl.blockIs(1, 64, -3, 'oak_planks')).toBe(false);
    expect(await ctlReplying(`${PASSED}\n`).ctl.blockIs(0, 0, 0, 'air')).toBe(true);
  });

  it('throws on any other reply and anchors the match', async () => {
    for (const reply of [
      UNLOADED,
      '',
      'Test passed. Count: 1',
      'xTest passed',
      'Test failed now',
    ]) {
      await expect(ctlReplying(reply).ctl.blockIs(0, 0, 0, 'air')).rejects.toThrow(/unexpected/);
    }
  });

  it('rejects bad coordinates and block ids before sending anything', async () => {
    const { ctl, commands } = ctlReplying(PASSED);
    await expect(ctl.blockIs(1.5, 0, 0, 'air')).rejects.toThrow(RangeError);
    await expect(ctl.blockIs(0, 400, 0, 'air')).rejects.toThrow(RangeError);
    await expect(ctl.blockIs(Number.NaN, 0, 0, 'air')).rejects.toThrow(RangeError);
    for (const block of ['', 'Stone', 'air; stop', 'air\nstop', 'a b', 'a'.repeat(65)]) {
      await expect(ctl.blockIs(0, 0, 0, block)).rejects.toThrow(RangeError);
    }
    expect(commands).toEqual([]);
  });
});

describe('limitedControl.isSleeping', () => {
  it('reads sleeping_pos and maps the replies', async () => {
    const asleep = ctlReplying(ASLEEP);
    expect(await asleep.ctl.isSleeping('GolemBench')).toBe(true);
    expect(asleep.commands).toEqual(['data get entity GolemBench sleeping_pos']);
    expect(await ctlReplying(NO_TAG).ctl.isSleeping('GolemBench')).toBe(false);
  });

  it('parses the replies captured live, for the exact and the lowercase name', async () => {
    for (const name of ['GolemProbe', 'golemprobe']) {
      expect(await ctlReplying(ASLEEP_LIVE).ctl.isSleeping(name)).toBe(true);
      expect(await ctlReplying(NO_TAG).ctl.isSleeping(name)).toBe(false);
    }
    // The wording the vanilla language file suggests is not what this server sends: stay strict.
    await expect(
      ctlReplying("Can't get sleeping_pos; tag doesn't exist").ctl.isSleeping('GolemBench'),
    ).rejects.toThrow(/unexpected/);
  });

  it('matches the name case-insensitively and through a team decoration', async () => {
    expect(await ctlReplying(ASLEEP).ctl.isSleeping('golembench')).toBe(true);
    expect(await ctlReplying(ASLEEP).ctl.isSleeping('GOLEMBENCH')).toBe(true);
    for (const shown of ['[Red] GolemBench', 'GolemBench [Red]', '[Red] GolemBench the Bold']) {
      const reply = `${shown} has the following entity data: [I; 16, 70, 80]`;
      expect(await ctlReplying(reply).ctl.isSleeping('golembench')).toBe(true);
    }
    // A longer name that merely contains the asked name is somebody else.
    const other = 'XGolemBench has the following entity data: [I; 16, 70, 80]';
    await expect(ctlReplying(other).ctl.isSleeping('GolemBench')).rejects.toThrow(/unexpected/);
  });

  it('throws on an unparsable reply, including an offline player', async () => {
    for (const reply of [
      NO_ENTITY,
      '',
      'GolemBench has the following entity data: 5',
      ASLEEP + 'x',
    ]) {
      await expect(ctlReplying(reply).ctl.isSleeping('GolemBench')).rejects.toThrow(/unexpected/);
    }
    await expect(ctlReplying(ASLEEP).ctl.isSleeping('Other')).rejects.toThrow(/unexpected/);
  });

  it('rejects names that are not usernames before sending anything', async () => {
    const { ctl, commands } = ctlReplying(NO_TAG);
    for (const name of ['', 'ab', 'a'.repeat(17), 'bad name', '@e', 'x\nkill @a']) {
      await expect(ctl.isSleeping(name)).rejects.toThrow(RangeError);
    }
    expect(commands).toEqual([]);
  });
});

describe('limitedControl allow-list', () => {
  const { ctl } = ctlReplying('');
  const allowed = [
    'effect',
    'effectClear',
    'timeSet',
    'fill',
    'chestItems',
    'gamerule',
    'blockIs',
    'isSleeping',
  ];

  it('exposes the allowed methods', () => {
    for (const name of allowed) {
      expect(typeof (ctl as unknown as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('still has no tp, give, setblock, command or whitelist methods', () => {
    for (const name of [
      'tp',
      'give',
      'setblock',
      'command',
      'whitelistAdd',
      'whitelistRemove',
      'kill',
      'clear',
    ]) {
      expect(() => (ctl as unknown as Record<string, unknown>)[name]).toThrow(/not available/);
    }
  });

  it('the new queries are not a path to free-form command text', () => {
    const source = readFileSync(new URL('./limited-control.ts', import.meta.url), 'utf8');
    for (const call of [
      '.tp(',
      '.give(',
      '.setblock(',
      '.whitelistAdd(',
      '.whitelistRemove(',
      '.kill(',
    ]) {
      expect(source).not.toContain(call);
    }
    // The only raw command calls are the two fixed read-only queries.
    const raw = source.match(/\.command\(`[^`]*`\)/g) ?? [];
    expect(raw).toEqual([
      ".command(`execute if block ${at.join(' ')} ${block}`)",
      '.command(`data get entity ${name} sleeping_pos`)',
    ]);
  });
});
