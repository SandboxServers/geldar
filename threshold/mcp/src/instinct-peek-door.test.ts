import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTH,
  AUTH_B,
  closeRigs,
  connectWith,
  HEADER,
  KEY,
  OTHER_PLAYER,
  PLAYER,
  type Rig,
  replyOf,
  startRig,
} from './instinct-door-rig.fixture.ts';

// GX-08 at the door: the wait's peek field, the class gate on it, and the delivered mark it must not
// move. The server keeps one MCP session per player, so a model client and an instinct client for the
// same player are never live together. Tests that need both up use two players; tests that observe
// the mark use one connection at a time on PLAYER and reconnect the next class in turn.

afterEach(closeRigs);

const INSTINCT = { ...AUTH, [HEADER]: KEY };

const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

/**
 * One wait call on the connection. `between` runs once the call is open (an event can be heard then),
 * and the clock moves past the deadline a second at a time, so the call ends on its own timer.
 */
async function waitFor(
  rig: Rig,
  client: Client,
  args: Record<string, unknown>,
  between?: () => Promise<void>,
): Promise<{ text: string; isError: boolean }> {
  const reply = replyOf(client, 'wait', args);
  await pause();
  if (between !== undefined) await between();
  for (let i = 0; i < 6; i++) {
    await pause();
    await rig.fx.clock.advance(1000);
  }
  return reply;
}

/**
 * A speech that addresses PLAYER, as event `seq` of its log (the fake log keeps one event per seq, and
 * a wait reads the events after its cursor). It wakes a wait at once.
 */
function heard(rig: Rig, seq: number, text: string): () => Promise<void> {
  return () =>
    rig.fx.body.emit(PLAYER.lifeId, {
      seq,
      tick: seq,
      atMs: 0,
      kind: 'speech',
      addressed: true,
      from: 'Adam',
      text,
      wakeOn: null,
    });
}

/** The field names of a reply's JSON text, sorted. */
function fieldsOf(text: string): string[] {
  return Object.keys(JSON.parse(text) as Record<string, unknown>).sort();
}

/** The sequence numbers of the events in a wait reply. */
function seqsOf(text: string): number[] {
  const parsed = JSON.parse(text) as { events?: { seq: number }[] };
  return (parsed.events ?? []).map((event) => event.seq);
}

describe('the wait peek field at the door', () => {
  it('a model connection is not advertised the wait peek field; an instinct connection is', async () => {
    const rig = await startRig(Buffer.from(KEY));
    const model = await connectWith(rig, AUTH, PLAYER);
    const instinct = await connectWith(rig, { ...AUTH_B, [HEADER]: KEY }, OTHER_PLAYER);
    const waitFields = async (client: Client): Promise<string[]> => {
      const listed = (await client.listTools()).tools.find((tool) => tool.name === 'wait');
      return Object.keys((listed?.inputSchema.properties ?? {}) as Record<string, unknown>);
    };
    expect(await waitFields(model)).toContain('max_seconds');
    expect(await waitFields(model)).not.toContain('peek');
    expect(await waitFields(instinct)).toContain('max_seconds');
    expect(await waitFields(instinct)).toContain('peek');
  });

  it('a model connection sending peek true gets a wait reply with the same fields as a plain wait, and no error', async () => {
    const rig = await startRig(Buffer.from(KEY));
    const model = await connectWith(rig, AUTH);
    const plain = await waitFor(rig, model, { max_seconds: 5 });
    const peeked = await waitFor(rig, model, { max_seconds: 5, peek: true });
    expect(plain.isError).toBe(false);
    expect(peeked.isError).toBe(false);
    expect(fieldsOf(peeked.text)).toEqual(fieldsOf(plain.text));
  });

  it('on one model connection a peek is an ordinary wait: it ends the open wait as wait_replaced', async () => {
    const rig = await startRig(Buffer.from(KEY));
    const model = await connectWith(rig, AUTH);
    const open = replyOf(model, 'wait', { max_seconds: 60 });
    await pause();
    const peek = replyOf(model, 'wait', { max_seconds: 5, peek: true });
    const replaced = await open;
    expect(replaced.isError).toBe(true);
    expect(replaced.text).toContain('wait_replaced');
    for (let i = 0; i < 6; i++) {
      await pause();
      await rig.fx.clock.advance(1000);
    }
    expect((await peek).isError).toBe(false);
  });

  it('a model peek moves the delivered mark as a plain wait does; an instinct peek leaves it where it was', async () => {
    const rig = await startRig(Buffer.from(KEY));
    const model = await connectWith(rig, AUTH);
    // the model's plain wait is given event 1: the delivered mark moves to 1
    const first = await waitFor(rig, model, { max_seconds: 5 }, heard(rig, 1, 'one'));
    expect(seqsOf(first.text)).toEqual([1]);

    // event 2 is heard; the instinct peek reads it and must leave the mark at 1
    await heard(rig, 2, 'two')();
    const instinct = await connectWith(rig, INSTINCT);
    const peeked = await waitFor(rig, instinct, { max_seconds: 5, peek: true });
    expect(seqsOf(peeked.text)).toEqual([2]);

    // so the model's next plain wait still gets event 2
    const afterPeek = await connectWith(rig, AUTH);
    expect(seqsOf((await waitFor(rig, afterPeek, { max_seconds: 5 })).text)).toEqual([2]);

    // event 3 is heard; a model peek is an ordinary wait, so the mark moves to 3 and the next
    // plain wait does not see event 3 again (a peek that moved nothing would hand it over again)
    await heard(rig, 3, 'three')();
    const modelPeek = await waitFor(rig, afterPeek, { max_seconds: 5, peek: true });
    expect(seqsOf(modelPeek.text)).toEqual([3]);
    const next = await waitFor(rig, afterPeek, { max_seconds: 5 });
    expect(seqsOf(next.text)).toEqual([]);
  }, 60_000);
});
