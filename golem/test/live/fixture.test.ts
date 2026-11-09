import { describe, expect, it, vi } from 'vitest';
import type { ConnectionManager } from '../../src/connection.ts';
import type { TestControl } from '../../src/test-control.ts';
import { runWithBot } from './fixture.ts';

// The arena and world helpers talk to a real server; only the whitelist order matters here.
vi.mock('../../src/arena.ts', () => ({
  buildArena: async () => ({ center: { x: 0, y: 0, z: 0 } }),
  quietWorld: async () => undefined,
  restoreWorld: async () => undefined,
}));

/** A control and manager that log every call the fixture makes, in order. */
function parts(opts: { removeFails?: boolean } = {}) {
  const log: string[] = [];
  const record = (entry: string) => async (): Promise<string> => {
    log.push(entry);
    return '';
  };
  const ctl = {
    whitelistAdd: record('whitelist add'),
    whitelistRemove: async () => {
      log.push('whitelist remove');
      if (opts.removeFails) throw new Error('rcon gone');
      return '';
    },
    clear: record('clear'),
    tp: record('tp'),
    command: record('command'),
  } as unknown as TestControl;
  const manager = {
    async start() {
      log.push('connect');
      return { waitForTicks: async () => undefined };
    },
    async stop() {
      log.push('stop');
    },
  } as unknown as ConnectionManager;
  const close = async () => {
    log.push('close');
  };
  return { log, live: { ctl, manager, close } };
}

describe('runWithBot', () => {
  it('whitelists the bot before it connects and removes it before closing', async () => {
    const p = parts();
    await runWithBot(p.live, { name: 'GolemTest', slot: 0 }, async () => {
      p.log.push('body');
    });
    expect(p.log.indexOf('whitelist add')).toBeGreaterThanOrEqual(0);
    expect(p.log.indexOf('whitelist add')).toBeLessThan(p.log.indexOf('connect'));
    expect(p.log.indexOf('whitelist remove')).toBeGreaterThan(p.log.indexOf('stop'));
    expect(p.log.at(-1)).toBe('close');
    expect(p.log.at(-2)).toBe('whitelist remove');
  });

  it('removes the whitelist entry even when the body throws', async () => {
    const p = parts();
    await expect(
      runWithBot(p.live, { name: 'GolemTest', slot: 0 }, async () => {
        throw new Error('body failed');
      }),
    ).rejects.toThrow('body failed');
    expect(p.log).toContain('whitelist remove');
    expect(p.log.at(-1)).toBe('close');
  });

  it('ignores a failing removal', async () => {
    const p = parts({ removeFails: true });
    await runWithBot(p.live, { name: 'GolemTest', slot: 0 }, async () => undefined);
    expect(p.log.at(-1)).toBe('close');
  });
});
