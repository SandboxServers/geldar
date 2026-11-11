import { afterEach, describe, expect, it } from 'vitest';
import { INIT, startDoor, TOKEN_A } from '../fakes/front-door.fakes.ts';
import type { FrontDoor } from './front.ts';

// The 0090 kill-switch shape, byte for byte: a 503 whose body names no switch and no config key.
const KILL_BODY = '{"error":{"code":"unavailable","message":"Service unavailable"}}';

let door: FrontDoor | undefined;

afterEach(async () => {
  await door?.close();
  door = undefined;
});

async function post(port: number, authorization?: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/p/aa`, {
    method: 'POST',
    headers: {
      ...(authorization === undefined ? {} : { Authorization: authorization }),
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: INIT,
  });
}

describe('public kill switch (public.kill_switch)', () => {
  it('answers a valid POST with 503 and the fixed kill-switch body', async () => {
    const started = await startDoor({ public: { killSwitch: true } });
    door = started.door;
    const res = await post(started.port, `Bearer ${TOKEN_A}`);
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.text()).toBe(KILL_BODY);
  });

  it('answers a GET stream with the same 503 body', async () => {
    const started = await startDoor({ public: { killSwitch: true } });
    door = started.door;
    const res = await fetch(`http://127.0.0.1:${started.port}/p/aa`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${TOKEN_A}`, Accept: 'text/event-stream' },
    });
    expect(res.status).toBe(503);
    expect(await res.text()).toBe(KILL_BODY);
  });

  it('refuses before authentication: a POST with no bearer gets the kill-switch 503, not a 401', async () => {
    const started = await startDoor({ public: { killSwitch: true } });
    door = started.door;
    const res = await post(started.port);
    expect(res.status).toBe(503);
    expect(await res.text()).toBe(KILL_BODY);
  });

  it('does not change the request when the switch is off: the same valid POST is served', async () => {
    const started = await startDoor();
    door = started.door;
    const res = await post(started.port, `Bearer ${TOKEN_A}`);
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain('Service unavailable');
  });
});
