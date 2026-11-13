import { EventEmitter, once } from 'node:events';
import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import { describe, expect, it, vi } from 'vitest';
import { completed } from './outcome.ts';
import { type ActionHandler, ActionRegistry, runAction } from './registry.ts';
import { wakeBot } from './wake.ts';

/** minecraft-protocol is mineflayer's dependency, not golem's, so it is resolved from mineflayer. */
const requireFromGolem = createRequire(import.meta.url);
const requireFromMineflayer = createRequire(requireFromGolem.resolve('mineflayer'));
interface ProtocolStream extends EventEmitter {
  write(chunk: unknown): boolean;
}
const protocol = requireFromMineflayer('minecraft-protocol') as {
  createSerializer(opts: { state: string; isServer: boolean; version: string }): ProtocolStream;
  createDeserializer(opts: { state: string; isServer: boolean; version: string }): ProtocolStream;
};
const VERSION = '26.1';
const clientSide = protocol.createSerializer({ state: 'play', isServer: false, version: VERSION });
const serverSide = protocol.createDeserializer({ state: 'play', isServer: true, version: VERSION });

interface Packet {
  name: string;
  params: Record<string, unknown>;
}

/** Client-to-server bytes for one packet, as minecraft-protocol writes them for 26.1. */
async function encode(packet: Packet): Promise<Buffer> {
  const out = once(clientSide, 'data');
  clientSide.write(packet);
  const [bytes] = await out;
  return bytes as Buffer;
}

/** What the server reads from those bytes. */
async function decode(bytes: Buffer): Promise<Packet> {
  const out = once(serverSide, 'data');
  serverSide.write(bytes);
  const [wrapped] = await out;
  // The parser wraps each packet as { data: { name, params }, metadata, ... }.
  const raw = wrapped as { data?: Packet } & Packet;
  return raw.data ?? raw;
}

/**
 * A bot whose client records each written packet. The fake server reads every `entity_action` through
 * the 26.1 deserializer and wakes the bot only for stop_sleeping, as the real server does.
 * `wake()` is mineflayer's own: `entity_action` with the numeric action id 2.
 */
function sleepingBot(serverWakes = true): { bot: Bot; written: Packet[]; emitter: EventEmitter } {
  const emitter = new EventEmitter();
  const written: Packet[] = [];
  const bot = Object.assign(emitter, {
    isSleeping: true,
    entity: { id: 7 },
    time: { age: 0 },
    _client: {
      write(name: string, params: Record<string, unknown>): void {
        written.push({ name, params });
        if (name !== 'entity_action' || !serverWakes) return;
        void encode({ name, params })
          .then(decode)
          .then((packet) => {
            if (packet.params.actionId !== 'stop_sleeping') return;
            bot.isSleeping = false;
            emitter.emit('wake');
          });
      },
    },
    wake(): void {
      this._client.write('entity_action', { entityId: 7, actionId: 2, jumpBoost: 0 });
    },
  });
  return { bot: bot as unknown as Bot, written, emitter };
}

describe('the wake packet on protocol 26.1', () => {
  it('decodes numeric action id 2 as stop_sprinting, which is what mineflayer bot.wake() sends', async () => {
    const decoded = await decode(
      await encode({ name: 'entity_action', params: { entityId: 7, actionId: 2, jumpBoost: 0 } }),
    );
    expect(decoded.params.actionId).toBe('stop_sprinting');
  });

  it('wakeBot writes the stop-sleeping action, which decodes as stop_sleeping', async () => {
    const { bot, written } = sleepingBot();
    expect(await wakeBot(bot)).toBe(true);
    expect(written).toHaveLength(1);
    expect(written[0]?.name).toBe('entity_action');
    const decoded = await decode(await encode(written[0] as Packet));
    expect(decoded.name).toBe('entity_action');
    expect(decoded.params.actionId).toBe('stop_sleeping');
    expect(decoded.params.entityId).toBe(7);
  });
});

describe('wakeBot and runAction', () => {
  const mine = { do: 'mine', block: 'oak_log', count: 2 } as const;

  it('a normal wake runs the handler', async () => {
    const { bot } = sleepingBot(true);
    const run = vi.fn(async () => completed());
    const registry = new ActionRegistry();
    registry.register({ kind: 'mine', timeoutMs: 5_000, run } as ActionHandler<'mine'>);
    const result = await runAction(registry, bot, mine);
    expect(bot.isSleeping).toBe(false);
    expect(run).toHaveBeenCalledOnce();
    expect(result.result.status).toBe('completed');
  });

  it('a bot the server never wakes fails "you are still in bed" and the handler does not run', async () => {
    const { bot } = sleepingBot(false);
    const run = vi.fn(async () => completed());
    const registry = new ActionRegistry();
    registry.register({ kind: 'mine', timeoutMs: 5_000, run } as ActionHandler<'mine'>);
    const result = await runAction(registry, bot, mine);
    expect(result.result.status).toBe('failed');
    expect(result.result.reason).toBe('blocked');
    expect(result.result.message).toBe('you are still in bed');
    expect(run).not.toHaveBeenCalled();
    expect(bot.isSleeping).toBe(true);
  });

  it('a write that throws fails the wake at once', async () => {
    const { bot } = sleepingBot(true);
    (bot as unknown as { _client: { write: () => void } })._client.write = () => {
      throw new Error('socket closed');
    };
    expect(await wakeBot(bot)).toBe(false);
  });
});
