import { readFileSync } from 'node:fs';
import { provenanceCombatSubject } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it, vi } from 'vitest';
import { bukkitWorldOf, type OwnerTransport } from '../../body/block-owners.ts';
import { observeFight } from './fight-seen.ts';
import { startObservations } from './subscribe.ts';

/*
 * The world argument of the fight observer (AN-50b). The subscription filters the world for every channel
 * before it calls an observer, and it also passes the Body's world to `observeFight`. These tests replace
 * the observer, so they check the argument itself rather than the filter in front of it.
 */

vi.mock('./fight-seen.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./fight-seen.ts')>()),
  observeFight: vi.fn(() => null),
}));

const SHARD = 'phase0';
const BODY = 'ag_capa_01';

const combat = (
  JSON.parse(readFileSync(new URL('./fixtures/combat-real.json', import.meta.url), 'utf8')) as {
    kill_engaged: Record<string, unknown>;
  }
).kill_engaged;

describe('the fight observer is given the Body world (AN-50b wiring)', () => {
  it('observeFight is called with the world the Body stands in, and the Body world is the fixture world', () => {
    const delivered: Array<(err: unknown, msg: { data: Uint8Array }) => void> = [];
    const transport: OwnerTransport = {
      request: async () => {
        throw new Error('not used');
      },
      subscribe(subject, opts) {
        if (subject === provenanceCombatSubject(SHARD)) delivered.push(opts.callback);
        return { unsubscribe() {} };
      },
    };
    const bot = {
      entity: { position: new Vec3(1310.5, 200, 800.5) },
      game: { dimension: 'minecraft:overworld' },
      time: { age: 5000 },
    } as unknown as Bot;
    const sub = startObservations({
      transport,
      shard: SHARD,
      lifeId: BODY,
      selfName: BODY,
      bot,
      publisher: { publish: async () => {} },
      resolve: () => null,
      canSee: () => true,
      log: () => {},
    });
    const data = new TextEncoder().encode(JSON.stringify(combat));
    for (const callback of delivered) callback(null, { data });

    const world = bukkitWorldOf(bot);
    expect(world).toBe('world');
    expect(observeFight).toHaveBeenCalledTimes(1);
    expect(vi.mocked(observeFight).mock.calls[0]?.[1]).toMatchObject({ world });
    sub.stop();
  });
});
