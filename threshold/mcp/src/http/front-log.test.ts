import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CANARY, type FrontRig, INIT, startFrontRig, TOKEN_A, TOKEN_B } from './front.fixture.ts';
import { frontLog } from './log.ts';

let rig: FrontRig;

beforeEach(async () => {
  rig = await startFrontRig();
});

afterEach(async () => {
  await rig.close();
});

describe('log lines', () => {
  it('never carry a token or a prefix of one', async () => {
    await rig.send('/p/aa', { body: INIT, headers: { Authorization: `Bearer ${CANARY}` } });
    await rig.send(`/p/aa?token=${CANARY}`, { body: INIT, headers: { Authorization: undefined } });
    await rig.send('/p/aa', {
      body: `{"jsonrpc":"2.0","id":1,"method":"${CANARY}"}`,
      headers: { Authorization: `Bearer ${CANARY}` },
    });
    await rig.send(`/p/aa`, {
      body: INIT,
      headers: { Authorization: `Bearer ${TOKEN_A}`, Origin: `https://${CANARY}.example` },
    });
    await rig.send('/p/aa', { body: INIT, headers: { host: `${CANARY}.example` } });
    await rig.send('/p/aa', { body: INIT });
    expect(rig.logs.length).toBeGreaterThan(0);
    const text = JSON.stringify(rig.logs);
    for (let length = 12; length <= CANARY.length; length += 1) {
      expect(text).not.toContain(CANARY.slice(0, length));
    }
    for (const token of [TOKEN_A, TOKEN_B]) {
      expect(text).not.toContain(token.slice(0, 12));
    }
  });
});

describe('log redaction', () => {
  it('keeps only the safe fields and reduces an error to its class', () => {
    const out: Record<string, string | number>[] = [];
    const log = frontLog((line) => out.push(line));
    log({
      event: 'unauthorized',
      player_id: 'aa',
      status: 401,
      authorization: `Bearer ${CANARY}`,
      body: CANARY,
      headers: { Authorization: `Bearer ${CANARY}` },
      error: `TypeError: ${CANARY}`,
    });
    expect(out).toEqual([
      { event: 'unauthorized', player_id: 'aa', status: 401, error: 'TypeError' },
    ]);
    expect(JSON.stringify(out)).not.toContain(CANARY.slice(0, 12));
  });
});
