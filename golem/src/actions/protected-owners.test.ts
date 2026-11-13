import type { Bot } from 'mineflayer';
import { afterEach, describe, expect, it } from 'vitest';
import { wireBlockOwners } from '../body/block-owners.ts';
import { recordOwnPlacement } from './own-placements.ts';
import { isProtected, type OwnerAnswer, setOwnerLookup } from './protected-blocks.ts';

/** The Body's bot: its username is the life id, which is what CoreProtect records (decision 0165). */
const SELF = 'ag_jason_01';
const botNamed = (): Bot =>
  ({ username: SELF, blockAt: () => null, game: { dimension: 'overworld' } }) as unknown as Bot;
const dirt = { name: 'dirt', position: { x: 5, y: 64, z: 5 } };

/** Answers every lookup with one fixed answer. */
const answering = (answer: OwnerAnswer): void => setOwnerLookup(() => answer);

afterEach(() => setOwnerLookup(null));

/** A transport that records each query's world and answers it with no blocks. */
function recordingTransport(worlds: string[]) {
  const enc = new TextEncoder();
  return {
    request: async (_subject: string, data: Uint8Array) => {
      const query = JSON.parse(new TextDecoder().decode(data)) as {
        world: string;
        chunk_x: number;
        chunk_z: number;
      };
      worlds.push(query.world);
      const body = { ...query, blocks: [], truncated: false };
      return { data: enc.encode(JSON.stringify(body)) };
    },
    subscribe: () => ({ unsubscribe: () => undefined }),
  };
}

describe('the query names the Bukkit world of the bot dimension (decision 0164)', () => {
  it.each([
    ['minecraft:overworld', 'world'],
    ['overworld', 'world'],
    ['minecraft:the_nether', 'world_nether'],
    ['minecraft:the_end', 'world_the_end'],
  ])('dimension %s asks for world %s', async (dimension, world) => {
    const worlds: string[] = [];
    const wired = wireBlockOwners({
      bot: { game: { dimension } },
      shard: 'phase0',
      transport: recordingTransport(worlds),
    });
    isProtected(botNamed(), dirt);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(worlds).toEqual([world]);
    wired.stop();
  });

  it('an unknown dimension asks nothing, and the block is protected', async () => {
    const worlds: string[] = [];
    const wired = wireBlockOwners({
      bot: { game: { dimension: 'minecraft:the_moon' } },
      shard: 'phase0',
      transport: recordingTransport(worlds),
    });
    expect(isProtected(botNamed(), dirt)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(worlds).toEqual([]);
    wired.stop();
  });
});

describe('the ownership record in the protection rule (decision 0165)', () => {
  it('a block another player placed is protected', () => {
    answering({ known: true, owner: 'ag_other_01' });
    expect(isProtected(botNamed(), dirt)).toBe(true);
  });

  it('a block recorded to the bot itself is diggable', () => {
    answering({ known: true, owner: SELF });
    expect(isProtected(botNamed(), dirt)).toBe(false);
  });

  it('a complete record with no owner leaves the natural rules: world-generated is diggable', () => {
    answering({ known: true, owner: null });
    expect(isProtected(botNamed(), dirt)).toBe(false);
  });

  it('an unknown record is protected', () => {
    answering({ known: false });
    expect(isProtected(botNamed(), dirt)).toBe(true);
  });

  it('a block the bot placed itself is its own work, even when the record is unknown', () => {
    answering({ known: false });
    const bot = botNamed();
    recordOwnPlacement(bot, { x: 5, y: 64, z: 5 }, 'dirt');
    expect(isProtected(bot, dirt)).toBe(false);
  });

  it('with no lookup set the rule is inert', () => {
    setOwnerLookup(null);
    expect(isProtected(botNamed(), dirt)).toBe(false);
  });

  it('a failed or timed-out query protects the block, and a reply with another owner does too', async () => {
    const enc = new TextEncoder();
    const wired = wireBlockOwners({
      bot: { game: { dimension: 'overworld' } },
      shard: 'phase0',
      transport: {
        request: async () => {
          throw new Error('timeout');
        },
        subscribe: () => ({ unsubscribe: () => undefined }),
      },
    });
    expect(isProtected(botNamed(), dirt)).toBe(true);
    wired.stop();
    expect(isProtected(botNamed(), dirt)).toBe(false);

    const replied = wireBlockOwners({
      bot: { game: { dimension: 'overworld' } },
      shard: 'phase0',
      transport: {
        request: async (_subject, data) => {
          const query = JSON.parse(new TextDecoder().decode(data)) as {
            world: string;
            chunk_x: number;
            chunk_z: number;
          };
          const body = {
            world: query.world,
            chunk_x: query.chunk_x,
            chunk_z: query.chunk_z,
            blocks: [{ x: 5, y: 64, z: 5, owner: 'ag_other_01' }],
            truncated: false,
          };
          return { data: enc.encode(JSON.stringify(body)) };
        },
        subscribe: () => ({ unsubscribe: () => undefined }),
      },
    });
    // The first read asks for the chunk; the answer lands on the next macrotask.
    expect(isProtected(botNamed(), dirt)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(isProtected(botNamed(), dirt)).toBe(true);
    replied.stop();
  });
});
