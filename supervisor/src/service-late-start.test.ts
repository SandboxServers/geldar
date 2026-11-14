import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FakeWorld } from './fakes.ts';
import type { ControlRequest, Op } from './ports.ts';
import { createSupervisor } from './service.ts';

const A = 'owner-a';
const B = 'owner-b';

function req(op: Op, ownerId: string, playerName: string): ControlRequest {
  return { op, ownerId, playerName };
}

function setup(runtimeTimeoutMs?: number) {
  const world = new FakeWorld();
  world.addPlayer('Ranger', A);
  world.addPlayer('Scout', B);
  world.addPlayer('Hawk', A);
  const deps = world.deps();
  const sup = createSupervisor(
    runtimeTimeoutMs === undefined ? deps : { ...deps, runtimeTimeoutMs },
  );
  return { world, sup, handle: (r: ControlRequest) => sup.handle(r) };
}

const start = (player: string, owner = A) => req('start', owner, player);
const stop = (player: string, owner = A) => req('stop', owner, player);
const STARTED = { ok: true, code: 'started' };
const UNKNOWN = { ok: false, code: 'unknown' };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('late starts: the newest attempt owns the name (review fix G)', () => {
  it('a late landing does not stop a newer start that already counted its body', async () => {
    const { world, handle } = setup(20);
    world.lateStartMs = 60;
    expect(await handle(start('Ranger'))).toEqual({ ok: false, code: 'error' });
    world.lateStartMs = null;
    expect(await handle(start('Ranger'))).toEqual(STARTED);
    await sleep(120);
    expect(world.bodies.get('ranger')?.running).toBe(true);
    expect(world.stops).toEqual(['ranger']);
    expect(world.startRows).toHaveLength(1);
  });

  it('a late landing while the newer start is still in flight is not compensated', async () => {
    const { world, handle } = setup(200);
    world.lateStartMs = 260;
    expect(await handle(start('Ranger'))).toEqual({ ok: false, code: 'error' });
    world.lateStartMs = 100;
    expect(await handle(start('Ranger'))).toEqual(STARTED);
    expect(world.stops).toEqual(['ranger']);
    expect(world.bodies.get('ranger')?.running).toBe(true);
    expect(world.startRows).toHaveLength(1);
  });

  it('a late landing after the newer start failed stops the body it left', async () => {
    const { world, handle } = setup(20);
    world.lateStartMs = 100;
    expect(await handle(start('Ranger'))).toEqual({ ok: false, code: 'error' });
    world.lateStartMs = null;
    world.startError = new Error('docker daemon went away');
    expect(await handle(start('Ranger'))).toEqual({ ok: false, code: 'error' });
    world.startError = null;
    await sleep(150);
    expect(world.bodies.get('ranger')?.running).toBe(false);
    expect(world.startRows).toHaveLength(0);
  });

  it('a late landing after the owner stopped the newer start stops the body it left', async () => {
    const { world, handle } = setup(20);
    world.lateStartMs = 100;
    expect(await handle(start('Ranger'))).toEqual({ ok: false, code: 'error' });
    world.lateStartMs = null;
    expect(await handle(start('Ranger'))).toEqual(STARTED);
    expect(await handle(stop('Ranger'))).toEqual({ ok: true, code: 'stopped' });
    await sleep(150);
    expect(world.bodies.get('ranger')?.running).toBe(false);
    expect(world.startRows).toHaveLength(1);
  });
});

describe('late start, owner move, abort signal and audit actor (review fix E)', () => {
  it('a start that completes after the timeout leaves no running body, and the next start counts once', async () => {
    const { world, handle } = setup(20);
    world.lateStartMs = 60;
    expect(await handle(start('Ranger'))).toEqual({ ok: false, code: 'error' });
    await sleep(120);
    expect(world.bodies.get('ranger')?.running).toBe(false);
    expect(world.startRows).toHaveLength(0);
    expect(world.auditRows.at(-1)?.outcome).toBe('error');
    world.lateStartMs = null;
    expect(await handle(start('Ranger'))).toEqual(STARTED);
    expect(world.startRows).toHaveLength(1);
  });

  it('a late start whose compensating stop throws still replies error, and the handler does not throw', async () => {
    const { world, handle } = setup(20);
    world.lateStartMs = 60;
    world.stopError = new Error('docker stop failed');
    expect(await handle(start('Ranger'))).toEqual({ ok: false, code: 'error' });
    await sleep(120);
    expect(world.startRows).toHaveLength(0);
    expect(world.auditRows.at(-1)?.outcome).toBe('error');
    expect(world.stops).toEqual(['ranger', 'ranger']);
  });

  it('a retry after a timed-out start keeps the retry body: the late landing of the first start stops nothing', async () => {
    const { world, handle } = setup(20);
    world.lateStartMs = 60;
    expect(await handle(start('Ranger'))).toEqual({ ok: false, code: 'error' });
    world.lateStartMs = null;
    expect(await handle(start('Ranger'))).toEqual(STARTED);
    await sleep(120);
    expect(world.bodies.get('ranger')?.running).toBe(true);
    expect(world.startRows).toHaveLength(1);
    expect(await handle(req('status', A, 'Ranger'))).toEqual({ ok: true, code: 'running' });
  });

  it('after the roster moves a stopped body to another owner, that owner can start the name', async () => {
    const { world, handle } = setup();
    expect(await handle(start('Ranger', A))).toEqual(STARTED);
    world.addPlayer('Ranger', B);
    expect(await handle(stop('Ranger', A))).toEqual({ ok: true, code: 'stopped' });
    expect(await handle(start('Ranger', B))).toEqual(STARTED);
    expect(world.startRows.map((r) => r.ownerId)).toEqual([A, B]);
    expect(world.bodies.get('ranger')).toEqual({ ownerId: B, playerName: 'ranger', running: true });
  });

  it('while the old owner body runs, the new roster owner cannot start the name', async () => {
    const { world, handle } = setup();
    expect(await handle(start('Ranger', A))).toEqual(STARTED);
    world.addPlayer('Ranger', B);
    expect(await handle(start('Ranger', B))).toEqual(UNKNOWN);
    expect(world.startRows).toHaveLength(1);
    expect(world.bodies.get('ranger')?.ownerId).toBe(A);
  });

  it('after the roster moved on and the old owner stopped its body, the old owner cannot start the name again', async () => {
    const { world, handle } = setup();
    await handle(start('Ranger', A));
    world.addPlayer('Ranger', B);
    await handle(stop('Ranger', A));
    expect(await handle(start('Ranger', A))).toEqual(UNKNOWN);
    expect(world.specs).toHaveLength(1);
    expect(world.startRows).toHaveLength(1);
  });

  it('the signal given to a runtime start is aborted when the call times out', async () => {
    const { world, handle } = setup(20);
    world.hangStart = true;
    expect(await handle(start('Ranger'))).toEqual({ ok: false, code: 'error' });
    expect(world.signals).toHaveLength(1);
    expect(world.signals[0]?.aborted).toBe(true);
  });

  it('the signal is not aborted when the runtime start completes in time', async () => {
    const { world, handle } = setup();
    expect(await handle(start('Ranger'))).toEqual(STARTED);
    expect(world.signals).toHaveLength(1);
    expect(world.signals[0]?.aborted).toBe(false);
  });

  it('after an insert failure whose stop also fails, a retry counts once and a third start is a noop', async () => {
    const { world, handle } = setup();
    world.insertError = new Error('database unavailable');
    world.stopError = new Error('docker stop failed');
    expect(await handle(start('Ranger'))).toEqual({ ok: false, code: 'error' });
    world.insertError = null;
    world.stopError = null;
    expect(await handle(start('Ranger'))).toEqual(STARTED);
    expect(await handle(start('Ranger'))).toEqual(STARTED);
    expect(world.specs).toHaveLength(2);
    expect(world.startRows).toHaveLength(1);
    expect(world.auditRows.at(-1)?.outcome).toBe('noop');
  });

  it('the audit actor is the sha256 prefix of the owner id, never the owner id itself', async () => {
    const { world, handle } = setup();
    await handle(start('Ranger', A));
    const expected = createHash('sha256').update('owner-a').digest('hex').slice(0, 16);
    expect(world.auditRows.at(-1)?.actor).toBe(expected);
    expect(world.auditRows.at(-1)?.actor).not.toBe('owner-a');
  });
});
