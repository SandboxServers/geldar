import { describe, expect, it } from 'vitest';
import type { GolemConfig } from '../../config.ts';
import {
  assertThrowawayTarget,
  BENCH_RCON_PORT,
  benchName,
  muffleLayout,
  parseSeq,
  runMuffleChat,
  THROWAWAY_FLAG,
  WALLS,
} from './muffle-chat.ts';

describe('assertThrowawayTarget', () => {
  it('accepts the bench RCON port without the flag', () => {
    expect(() => assertThrowawayTarget(BENCH_RCON_PORT, false)).not.toThrow();
  });

  it('refuses any other port without the flag, including the phase0 RCON port', () => {
    expect(() => assertThrowawayTarget(25575, false)).toThrow(/refusing/);
    expect(() => assertThrowawayTarget(26565, false)).toThrow(/refusing/);
  });

  it('accepts another port only with the throwaway flag', () => {
    expect(() => assertThrowawayTarget(25575, true)).not.toThrow();
    expect(THROWAWAY_FLAG).toBe('--i-know-this-is-a-throwaway');
  });
});

describe('runMuffleChat guard', () => {
  it('refuses before it opens any connection, on the phase0 RCON port', async () => {
    const cfg = { mcHost: '127.0.0.1', mcPort: 25565, rconHost: '127.0.0.1', rconPort: 25575 };
    await expect(
      runMuffleChat({ bots: 9, cfg: cfg as GolemConfig, throwawayFlag: false }),
    ).rejects.toThrow(/refusing/);
  });
});

describe('muffleLayout', () => {
  it('builds 9 bots: a speaker, seven row listeners and the sealed listener', () => {
    const layout = muffleLayout(9);
    expect(layout.spots).toHaveLength(9);
    expect(layout.spots[0]).toMatchObject({ role: 'speaker', distance: 0, blocks: [] });
    const listeners = layout.spots.slice(1);
    expect(listeners.map((s) => s.distance)).toEqual([2, 5, 9, 13, 17, 21, 25, 40]);
  });

  it('builds 15 bots with a second row 2 blocks north', () => {
    const layout = muffleLayout(15);
    expect(layout.spots).toHaveLength(15);
    const second = layout.spots.filter((s) => s.z === 2);
    expect(second).toHaveLength(6);
    expect(second.map((s) => s.distance)).toEqual([2.83, 5.39, 9.22, 13.15, 17.12, 21.1]);
  });

  it('lists the walls between the speaker and each listener, nearest first', () => {
    const at = (distance: number) => muffleLayout(9).spots.find((s) => s.distance === distance);
    expect(at(2)?.blocks).toEqual([]);
    expect(at(5)?.blocks).toEqual(['stone']);
    expect(at(13)?.blocks).toEqual(['stone', 'glass', 'oak_planks']);
    expect(at(25)?.blocks).toEqual([
      'stone',
      'glass',
      'oak_planks',
      'white_wool',
      'tinted_glass',
      'stone_brick_slab',
    ]);
  });

  it('puts the sealed listener behind every wall and its stone shell', () => {
    const sealed = muffleLayout(9).spots.at(-1);
    expect(sealed?.distance).toBe(40);
    expect(sealed?.blocks).toEqual([...WALLS.map((w) => w.block), 'stone']);
  });

  it('gives unique, valid Minecraft usernames', () => {
    const names = muffleLayout(15).spots.map((s) => s.name);
    expect(new Set(names).size).toBe(15);
    for (const name of names) expect(name).toMatch(/^[A-Za-z0-9_]{3,16}$/);
    expect(benchName(0)).toBe('MuffleBench00');
  });

  it('refuses any other bot count', () => {
    expect(() => muffleLayout(10)).toThrow(RangeError);
    expect(() => muffleLayout(1)).toThrow(RangeError);
  });

  it('keeps every fill box inside the x and z range the world border allows', () => {
    for (const box of muffleLayout(15).boxes) {
      expect(Math.abs(box.from.x)).toBeLessThan(100);
      expect(Math.abs(box.to.z)).toBeLessThan(100);
    }
  });
});

describe('parseSeq', () => {
  it('reads the sequence number of a bench line and nothing else', () => {
    expect(parseSeq('mh8a L7 alpha bravo charlie')).toBe(7);
    expect(parseSeq('hello there')).toBeNull();
    expect(parseSeq('xmh8a L7 alpha')).toBeNull();
  });
});
