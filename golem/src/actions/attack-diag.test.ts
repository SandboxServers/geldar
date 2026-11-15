import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it, vi } from 'vitest';
import { attackAction } from './attack.ts';

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
});
