import { afterEach, describe, expect, it } from 'vitest';
import {
  DelayedTokenStore,
  postInit,
  sleep,
  startDoor,
  storeWithTokenA,
  TOKEN_A,
} from '../fakes/front-door.fakes.ts';
import type { FrontDoor } from './front.ts';

let door: FrontDoor | undefined;

afterEach(async () => {
  await door?.close();
  door = undefined;
});

describe('open slots when a client aborts during authentication', () => {
  it('releases the player and address slots of requests aborted in authentication', async () => {
    // Each request is cut at 10 ms, while its 50 ms token lookup is still pending. Five of them
    // exceed the per-player cap of 4, so a slot that leaked would refuse the next request.
    const started = await startDoor({ store: storeWithTokenA(new DelayedTokenStore(50)) });
    door = started.door;
    for (let i = 0; i < 5; i++) {
      await postInit(started.port, TOKEN_A, { abortAfterMs: 10 });
    }
    // Let the five lookups finish after their clients left.
    await sleep(200);
    const replies = await Promise.all([1, 2, 3].map(() => postInit(started.port, TOKEN_A)));
    expect(replies.map((reply) => reply.status)).toEqual([200, 200, 200]);
  });
});
