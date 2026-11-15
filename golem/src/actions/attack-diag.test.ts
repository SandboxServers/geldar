import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it, vi } from 'vitest';
import { ATTACK_DIAG_INTERVAL_MS, attackAction } from './attack.ts';
import { DEFAULT_DIAG_SINK } from './stall-diag.ts';

/** Runs one attack call on an already aborted signal: the line is written, then the action stops. */
function attackOnce(bot: Bot, target: string): ReturnType<typeof attackAction.run> {
  const aborted = new AbortController();
  aborted.abort();
  return attackAction.run({ bot, signal: aborted.signal, timeScale: 1 }, { do: 'attack', target });
}

/** The attack_diag lines written through the diagnostic sink so far. */
function attackDiagLines(log: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
  return log.mock.calls
    .map((call) => JSON.parse(String(call[0])) as Record<string, unknown>)
    .filter((line) => line.event === 'attack_diag');
}

/** A bot with one phantom two blocks away and nothing in its hands or pack. */
function phantomBot(): Bot {
  const phantom = {
    id: 7,
    name: 'phantom',
    type: 'hostile',
    position: new Vec3(2, 64, 0),
    height: 1,
    isValid: true,
  };
  const self = { position: new Vec3(0, 64, 0) };
  const entities: Record<string, unknown> = { 7: phantom, 1: self };
  const bot = {
    entity: self,
    entities,
    heldItem: null,
    inventory: { items: () => [] },
    equip: vi.fn(async () => undefined),
    lookAt: vi.fn(async () => undefined),
    attack: vi.fn(() => undefined),
    waitForTicks: vi.fn(async () => undefined),
    on: vi.fn(),
    removeListener: vi.fn(),
  };
  return bot as unknown as Bot;
}

describe('attack operator diagnostic (decision 0335)', () => {
  it('writes an attack_diag line that names the target entity and its distance', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const aborted = new AbortController();
    aborted.abort();
    await attackAction.run(
      { bot: phantomBot(), signal: aborted.signal, timeScale: 1 },
      { do: 'attack', target: 'phantom' },
    );
    const lines = log.mock.calls
      .map((call) => JSON.parse(String(call[0])) as Record<string, unknown>)
      .filter((line) => line.event === 'attack_diag');
    log.mockRestore();
    expect(lines).toEqual([
      {
        event: 'attack_diag',
        target: 'phantom',
        entity: 'phantom',
        distance: 2,
        target_kind: 'mob',
      },
    ]);
  });

  it('names the attacked target, not the entity it matched (a player found by username)', async () => {
    const bot = phantomBot() as unknown as { entities: Record<string, unknown> };
    bot.entities[9] = {
      id: 9,
      name: 'player',
      username: 'Alice',
      type: 'player',
      position: new Vec3(1, 64, 0),
      height: 1.8,
      isValid: true,
    };
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await attackOnce(bot as unknown as Bot, 'Alice');
    const lines = attackDiagLines(log);
    log.mockRestore();
    expect(lines).toEqual([
      {
        event: 'attack_diag',
        target: 'Alice',
        entity: 'player',
        distance: 1,
        target_kind: 'player',
      },
    ]);
  });
});

describe('attack_diag rate limit (decision 0335)', () => {
  it('writes one line per bot per 2 s: a call inside the window writes nothing, the edge writes', async () => {
    let clock = 0;
    const now = vi.spyOn(DEFAULT_DIAG_SINK, 'now').mockImplementation(() => clock);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const bot = phantomBot();
    clock = 0;
    await attackOnce(bot, 'phantom');
    clock = ATTACK_DIAG_INTERVAL_MS - 1;
    await attackOnce(bot, 'phantom');
    clock = ATTACK_DIAG_INTERVAL_MS;
    await attackOnce(bot, 'phantom');
    const lines = attackDiagLines(log);
    now.mockRestore();
    log.mockRestore();
    expect(ATTACK_DIAG_INTERVAL_MS).toBe(2_000);
    expect(lines.map((line) => line.target)).toEqual(['phantom', 'phantom']);
  });

  it('keeps a separate window per bot, so a new bot (a new life) writes its own line', async () => {
    const now = vi.spyOn(DEFAULT_DIAG_SINK, 'now').mockImplementation(() => 0);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await attackOnce(phantomBot(), 'phantom');
    await attackOnce(phantomBot(), 'phantom');
    const lines = attackDiagLines(log);
    now.mockRestore();
    log.mockRestore();
    expect(lines).toHaveLength(2);
  });

  it('a failed equip writes no line and does not start the window', async () => {
    let clock = 0;
    const now = vi.spyOn(DEFAULT_DIAG_SINK, 'now').mockImplementation(() => clock);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const bot = phantomBot() as unknown as Record<string, unknown>;
    bot.inventory = { items: () => [{ name: 'iron_sword' }] };
    const equip = vi
      .fn()
      .mockRejectedValueOnce(new Error('no hands free'))
      .mockResolvedValue(undefined);
    bot.equip = equip;
    clock = 0;
    const failed = await attackOnce(bot as unknown as Bot, 'phantom');
    const afterFailure = attackDiagLines(log).length;
    clock = 500;
    await attackOnce(bot as unknown as Bot, 'phantom');
    const lines = attackDiagLines(log);
    now.mockRestore();
    log.mockRestore();
    expect(failed.status).toBe('failed');
    expect(afterFailure).toBe(0);
    expect(lines).toHaveLength(1);
  });
});
