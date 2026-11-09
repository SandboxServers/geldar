import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Arena, buildArena, GAMERULES, quietWorld, restoreWorld } from '../../src/arena.ts';
import { loadConfig, readRconPassword } from '../../src/config.ts';
import { RconClient } from '../../src/rcon.ts';
import { TestControl } from '../../src/test-control.ts';

// Needs the running shard: `./geldar.ps1 shard up phase0` first. Each live file uses its own
// bot name; this one only whitelists GolemSmoke and never connects it.
const RULES = Object.values(GAMERULES);

let rcon: RconClient;
let ctl: TestControl;
let arena: Arena;

/** Reads a gamerule back and returns 'true' or 'false'. */
async function ruleValue(name: string): Promise<string> {
  const reply = await ctl.gamerule(name);
  const value = /(true|false)/.exec(reply)?.[1];
  if (value === undefined) throw new Error(`gamerule ${name} replied: ${reply}`);
  return value;
}

beforeAll(async () => {
  const cfg = loadConfig();
  const password = await readRconPassword(cfg);
  rcon = await RconClient.connect({ host: cfg.rconHost, port: cfg.rconPort, password });
  ctl = new TestControl(rcon);
}, 120_000);

afterAll(async () => {
  // Restore even when a test failed; a killed run is reset by `shard down` then `up`.
  if (ctl !== undefined) await restoreWorld(ctl);
  await rcon?.close();
}, 120_000);

describe('RCON test control against the shard', () => {
  it('lists players', async () => {
    expect(await ctl.command('list')).toMatch(/^There are/);
  });

  it('whitelists GolemSmoke', async () => {
    await expect(ctl.whitelistAdd('GolemSmoke')).resolves.toBeUndefined();
  });

  it('reads the tick rate', async () => {
    expect(await ctl.tickQuery()).toMatch(/tick rate/i);
  });

  it('quiets the world and reads each rule back as false', async () => {
    await quietWorld(ctl);
    for (const rule of RULES) {
      expect(await ruleValue(rule), rule).toBe('false');
    }
  });

  it('builds the arena and reads an empty chest', async () => {
    arena = await buildArena(ctl, 0);
    const { x, y, z } = arena.center;
    await ctl.setblock(x, y, z, 'chest');
    try {
      const raw = await ctl.command(`data get block ${x} ${y} ${z} Items`);
      console.log(`raw chest reply: ${raw}`);
      expect((await ctl.chestItems(x, y, z)).size).toBe(0);
    } finally {
      await ctl.setblock(x, y, z, 'air');
    }
  });

  it('restores the world and reads each rule back as true', async () => {
    await restoreWorld(ctl);
    for (const rule of RULES) {
      expect(await ruleValue(rule), rule).toBe('true');
    }
    expect(await ctl.tickQuery()).toMatch(/\b20(\.0)?\b/);
  });
});
