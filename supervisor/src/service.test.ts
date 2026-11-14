import { describe, expect, it, vi } from 'vitest';
import { FakeWorld } from './fakes.ts';
import { BODY_MEMORY_BYTES, BODY_NANO_CPUS } from './limits.ts';
import { type ControlRequest, type LogEvent, LoginNameError, type Op } from './ports.ts';
import { DAY_MS, HOUR_MS, LOG_TAIL_LIMIT, LOG_TAIL_WINDOW_MS } from './quotas.ts';
import { createSupervisor, RUNTIME_TIMEOUT_MS } from './service.ts';

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
  world.addPlayer('Wren', A);
  world.addPlayer('Finch', A);
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

describe('login name refusal (C7-03b, fix K F1)', () => {
  it('a name outside the login shape replies login_name, writes no start row, and does not count', async () => {
    const { world, handle } = setup();
    world.startError = new LoginNameError();
    expect(await handle(start('Ranger'))).toEqual({ ok: false, code: 'login_name' });
    expect(world.startRows).toEqual([]);
    expect(world.auditRows.at(-1)).toMatchObject({ action: 'body_start', outcome: 'login_name' });
    world.startError = null;
    expect(await handle(start('Ranger'))).toEqual(STARTED);
    expect(world.startRows).toHaveLength(1);
  });
});

describe('restart login name check runs before the running body stops (fix K, orchestrator)', () => {
  it('a restart with a bad login name keeps the running body up, replies login_name, and writes no start row', async () => {
    const { world, handle } = setup();
    expect(await handle(start('Ranger'))).toEqual(STARTED);
    world.loginNameBad = true;
    expect(await handle(req('restart', A, 'Ranger'))).toEqual({ ok: false, code: 'login_name' });
    expect(world.bodies.get('ranger')?.running).toBe(true);
    expect(world.stops).toEqual([]);
    expect(world.startRows).toHaveLength(1);
  });
});

describe('association: an owner acts only on their own roster names', () => {
  it('owner A stopping owner B body gets the unknown reply and changes nothing', async () => {
    const { world, handle } = setup();
    expect(await handle(start('Scout', B))).toEqual(STARTED);
    const crossOwner = await handle(stop('Scout', A));
    const noSuchPlayer = await handle(stop('Nobody', A));
    expect(crossOwner).toEqual(noSuchPlayer);
    expect(crossOwner).toEqual({ ok: false, code: 'unknown' });
    expect(world.bodies.get('scout')?.running).toBe(true);
    expect(world.startRows).toHaveLength(1);
  });

  it('a start by a non-owner of the player gets the same reply as an unknown player', async () => {
    const { handle } = setup();
    const wrongOwner = await handle(start('Scout', A));
    const unknownPlayer = await handle(start('Nobody', A));
    expect(wrongOwner).toEqual(unknownPlayer);
    expect(wrongOwner).toEqual({ ok: false, code: 'unknown' });
  });

  it('a status or logtail request for another owner body is refused as unknown', async () => {
    const { handle } = setup();
    await handle(start('Scout', B));
    expect(await handle(req('status', A, 'Scout'))).toEqual({ ok: false, code: 'unknown' });
    expect(await handle(req('logtail', A, 'Scout'))).toEqual({ ok: false, code: 'unknown' });
  });

  it('one name starts one body: repeat starts by the owner change nothing and count nothing', async () => {
    const { world, handle } = setup();
    expect(await handle(start('Ranger'))).toEqual(STARTED);
    for (let i = 0; i < 5; i++) {
      expect(await handle(start('Ranger'))).toEqual(STARTED);
    }
    expect(world.specs).toHaveLength(1);
    expect(world.startRows).toHaveLength(1);
  });

  it('owner A cannot start or stop owner B name, and B can still start it', async () => {
    const { world, handle } = setup();
    expect(await handle(start('Scout', A))).toEqual({ ok: false, code: 'unknown' });
    expect(await handle(stop('Scout', A))).toEqual({ ok: false, code: 'unknown' });
    expect(world.specs).toHaveLength(0);
    expect(await handle(start('Scout', B))).toEqual(STARTED);
  });

  it('a body held by another owner refuses a restart when the roster moves the name to the caller', async () => {
    const { world, handle } = setup();
    expect(await handle(start('Ranger', A))).toEqual(STARTED);
    world.addPlayer('Ranger', B);
    expect(await handle(req('restart', B, 'Ranger'))).toEqual({ ok: false, code: 'unknown' });
    expect(world.stops).toHaveLength(0);
    expect(world.bodies.get('ranger')).toEqual({ ownerId: A, playerName: 'ranger', running: true });
  });

  it('after the roster removes a name, its owner can still stop the body but not read its status or logs', async () => {
    const { world, handle } = setup();
    await handle(start('Ranger', A));
    world.roster.delete('ranger');
    expect(await handle(req('status', A, 'Ranger'))).toEqual(UNKNOWN);
    expect(await handle(req('logtail', A, 'Ranger'))).toEqual(UNKNOWN);
    expect(world.bodies.get('ranger')?.running).toBe(true);
    expect(world.stops).toHaveLength(0);
    expect(await handle(stop('Ranger', A))).toEqual({ ok: true, code: 'stopped' });
    expect(world.bodies.get('ranger')?.running).toBe(false);
  });

  it('a removed name is stoppable only by the owner of its body, not by another owner', async () => {
    const { world, handle } = setup();
    await handle(start('Ranger', A));
    world.roster.delete('ranger');
    expect(await handle(stop('Ranger', B))).toEqual(UNKNOWN);
    expect(world.bodies.get('ranger')?.running).toBe(true);
  });

  it('roster names are case-insensitive: Ranger and ranger are one body, held by one owner', async () => {
    const { world, handle } = setup();
    expect(await handle(start('Ranger', A))).toEqual(STARTED);
    expect(await handle(start('ranger', A))).toEqual(STARTED);
    expect(await handle(start('RANGER', B))).toEqual(UNKNOWN);
    expect(world.specs).toHaveLength(1);
    expect(world.startRows).toHaveLength(1);
    expect(await handle(stop('RANGER', A))).toEqual({ ok: true, code: 'stopped' });
    expect(world.bodies.get('ranger')?.running).toBe(false);
  });
});

describe('roster read from the database', () => {
  it('a player listed only in the database roster can start', async () => {
    const { world, handle } = setup();
    world.addPlayer('NewName', A);
    expect(await handle(start('NewName'))).toEqual(STARTED);
  });

  it('a name the roster does not list is refused for an owner request', async () => {
    const { world, handle } = setup();
    expect(await handle(start('YamlOnly'))).toEqual({ ok: false, code: 'unknown' });
    expect(world.specs).toHaveLength(0);
  });
});

describe('player name shape (roster rule, review fix D, F4)', () => {
  it.each([
    ['a NUL byte', 'a\u0000b'],
    ['a newline', 'a\nb'],
    ['spaces only', '   '],
    ['17 characters', 'x'.repeat(17)],
    ['an empty name', ''],
  ])('%s is refused as invalid and audited with no target', async (_label, name) => {
    const { world, sup } = setup();
    expect(await sup.handle({ op: 'start', ownerId: A, playerName: name })).toEqual({
      ok: false,
      code: 'invalid',
    });
    expect(world.auditRows.at(-1)?.action).toBe('body_invalid');
    expect(world.auditRows.at(-1)?.target).toBe('invalid');
    expect(world.specs).toHaveLength(0);
  });

  it('a 16 character name of letters, digits and underscores is accepted', async () => {
    const { world, handle } = setup();
    const sixteen = 'Abcdefghij_12345';
    expect(sixteen).toHaveLength(16);
    world.addPlayer(sixteen, A);
    expect(await handle(start(sixteen))).toEqual(STARTED);
  });

  it('__proto__ is a valid roster shape: an unlisted name gets unknown and is audited by its own name', async () => {
    const { world, sup } = setup();
    expect(await sup.handle({ op: 'start', ownerId: A, playerName: '__proto__' })).toEqual(UNKNOWN);
    expect(world.auditRows.at(-1)?.target).toBe('__proto__');
    expect(world.specs).toHaveLength(0);
  });
});

describe('quotas at the boundary (decision 0170, point 3)', () => {
  it('the third start of a name in an hour is accepted and the fourth is refused and audited', async () => {
    const { world, handle } = setup();
    for (let i = 0; i < 3; i++) {
      expect(await handle(start('Ranger'))).toEqual(STARTED);
      expect(await handle(stop('Ranger'))).toEqual({ ok: true, code: 'stopped' });
    }
    expect(await handle(start('Ranger'))).toEqual({ ok: false, code: 'quota' });
    expect(world.startRows).toHaveLength(3);
    const last = world.auditRows.at(-1);
    expect(last?.outcome).toBe('quota');
    expect(last?.detail).toBe('agent_hour');
    expect(last?.admin).toBe(false);
  });

  it('the name hour window slides: at one hour exactly the old starts no longer count', async () => {
    const { world, handle } = setup();
    for (let i = 0; i < 3; i++) {
      await handle(start('Ranger'));
      await handle(stop('Ranger'));
    }
    world.now = new Date(world.now.getTime() + HOUR_MS - 1000);
    expect(await handle(start('Ranger'))).toEqual({ ok: false, code: 'quota' });
    world.now = new Date(world.now.getTime() + 1000);
    expect(await handle(start('Ranger'))).toEqual(STARTED);
  });

  it('the tenth start of an owner in a day is accepted and the eleventh is refused', async () => {
    const { world, handle } = setup();
    for (const player of ['Ranger', 'Hawk', 'Wren']) {
      for (let i = 0; i < 3; i++) {
        expect(await handle(start(player))).toEqual(STARTED);
        await handle(stop(player));
      }
    }
    expect(await handle(start('Finch'))).toEqual(STARTED);
    await handle(stop('Finch'));
    expect(world.startRows).toHaveLength(10);
    expect(await handle(start('Finch'))).toEqual({ ok: false, code: 'quota' });
    expect(world.startRows).toHaveLength(10);
    expect(world.auditRows.at(-1)?.detail).toBe('owner_day');
  });

  it('a refused request does not count toward a later start', async () => {
    const { world, handle } = setup();
    for (let i = 0; i < 3; i++) {
      await handle(start('Ranger'));
      await handle(stop('Ranger'));
    }
    for (let i = 0; i < 5; i++) await handle(start('Ranger'));
    expect(world.startRows).toHaveLength(3);
  });

  it('stop, status and logtail do not count toward the quotas', async () => {
    const { world, handle } = setup();
    await handle(start('Ranger'));
    for (let i = 0; i < 6; i++) {
      await handle(stop('Ranger'));
      await handle(req('status', A, 'Ranger'));
      await handle(req('logtail', A, 'Ranger'));
    }
    expect(world.startRows).toHaveLength(1);
  });

  it('a restart that is accepted counts like a start', async () => {
    const { world, handle } = setup();
    await handle(start('Ranger'));
    expect(await handle(req('restart', A, 'Ranger'))).toEqual({
      ok: true,
      code: 'restarted',
    });
    expect(world.startRows.map((r) => r.op)).toEqual(['start', 'restart']);
    expect(world.stops).toContain('ranger');
  });
});

describe('admin owners (decision 0170, point 5)', () => {
  it('an admin is exempt from the hourly name counter: the fourth start is accepted', async () => {
    const { world, handle } = setup();
    world.admins.add(A);
    for (let i = 0; i < 3; i++) {
      await handle(start('Ranger'));
      await handle(stop('Ranger'));
    }
    expect(await handle(start('Ranger'))).toEqual(STARTED);
    expect(world.auditRows.at(-1)?.admin).toBe(true);
  });

  it('an admin is exempt from the daily owner counter: the twelfth start is accepted', async () => {
    const { world, handle } = setup();
    world.admins.add(A);
    for (const player of ['Ranger', 'Hawk', 'Wren', 'Finch']) {
      for (let i = 0; i < 3; i++) {
        expect(await handle(start(player))).toEqual(STARTED);
        await handle(stop(player));
      }
    }
    expect(world.startRows).toHaveLength(12);
  });

  it('an admin repeat start of a running body is the same started reply, counts nothing, and is audited as noop', async () => {
    const { world, handle } = setup();
    world.admins.add(A);
    await handle(start('Ranger'));
    expect(await handle(start('Ranger'))).toEqual(STARTED);
    expect(world.startRows).toHaveLength(1);
    expect(world.auditRows.at(-1)?.admin).toBe(true);
    expect(world.auditRows.at(-1)?.outcome).toBe('noop');
  });

  it('an admin still gets the unknown reply for another owner body', async () => {
    const { world, handle } = setup();
    world.admins.add(A);
    await handle(start('Scout', B));
    expect(await handle(stop('Scout', A))).toEqual({ ok: false, code: 'unknown' });
    expect(world.bodies.get('scout')?.running).toBe(true);
  });

  it('a flag read that errors is treated as not admin: the fourth start is refused', async () => {
    const { world, handle } = setup();
    world.admins.add(A);
    world.adminReadFails = true;
    for (let i = 0; i < 3; i++) {
      await handle(start('Ranger'));
      await handle(stop('Ranger'));
    }
    expect(await handle(start('Ranger'))).toEqual({ ok: false, code: 'quota' });
    expect(world.auditRows.at(-1)?.admin).toBe(false);
  });
});

describe('concurrency', () => {
  it('two starts for one name race and exactly one body starts', async () => {
    const { world, handle } = setup();
    const replies = await Promise.all([handle(start('Ranger')), handle(start('Ranger'))]);
    expect(replies).toEqual([STARTED, STARTED]);
    expect(world.specs).toHaveLength(1);
    expect(world.startRows).toHaveLength(1);
  });
});

describe('container config carries the 0082 body limits', () => {
  it('the started body gets 1 CPU and 2048m memory with no extra swap', async () => {
    const { world, handle } = setup();
    await handle(start('Ranger'));
    expect(world.specs[0]?.config).toEqual({
      NanoCpus: 1_000_000_000,
      Memory: 2048 * 1024 * 1024,
      MemorySwap: 2048 * 1024 * 1024,
      PidsLimit: 256,
    });
    expect(BODY_NANO_CPUS).toBe(1_000_000_000);
    expect(BODY_MEMORY_BYTES).toBe(2048 * 1024 * 1024);
  });
});

describe('abort and error paths', () => {
  it('a Docker error is reported and audited, and keeps no body_ops row', async () => {
    const { world, handle } = setup();
    world.startError = new Error('docker daemon went away');
    expect(await handle(start('Ranger'))).toEqual({ ok: false, code: 'error' });
    expect(world.startRows).toHaveLength(0);
    expect(world.bodies.get('ranger')?.running ?? false).toBe(false);
    expect(world.auditRows.at(-1)?.outcome).toBe('error');
  });

  it('a retry after a Docker error starts once and counts once', async () => {
    const { world, handle } = setup();
    world.startError = new Error('docker daemon went away');
    await handle(start('Ranger'));
    world.startError = null;
    expect(await handle(start('Ranger'))).toEqual(STARTED);
    expect(world.specs).toHaveLength(1);
    expect(world.startRows).toHaveLength(1);
  });

  it('a failed row insert stops the started body, replies error and audits error', async () => {
    const { world, handle } = setup();
    world.insertError = new Error('database unavailable');
    expect(await handle(start('Ranger'))).toEqual({ ok: false, code: 'error' });
    expect(world.stops).toEqual(['ranger']);
    expect(world.bodies.get('ranger')?.running).toBe(false);
    expect(world.startRows).toHaveLength(0);
    expect(world.auditRows.at(-1)?.outcome).toBe('error');
    world.insertError = null;
    expect(await handle(start('Ranger'))).toEqual(STARTED);
    expect(world.startRows).toHaveLength(1);
  });

  it('an insert failure whose compensating stop also throws still replies error, and a retry starts once', async () => {
    const { world, handle } = setup();
    world.insertError = new Error('database unavailable');
    world.stopError = new Error('docker stop failed');
    expect(await handle(start('Ranger'))).toEqual({ ok: false, code: 'error' });
    expect(world.stops).toEqual(['ranger']);
    expect(world.auditRows.at(-1)?.outcome).toBe('error');
    world.insertError = null;
    world.stopError = null;
    expect(await handle(start('Ranger'))).toEqual(STARTED);
    expect(world.startRows).toHaveLength(1);
  });

  it('a runtime call that never answers is cut off, replied as error, and the queue drains', async () => {
    const { world, handle } = setup(20);
    world.hangStart = true;
    expect(await handle(start('Ranger'))).toEqual({ ok: false, code: 'error' });
    expect(world.startRows).toHaveLength(0);
    expect(world.auditRows.at(-1)?.outcome).toBe('error');
    world.hangStart = false;
    expect(await handle(start('Ranger'))).toEqual(STARTED);
  });

  it('the default runtime timeout is 15 seconds', () => {
    expect(RUNTIME_TIMEOUT_MS).toBe(15_000);
  });

  it('an audit failure on a refusal rejects the request, and the owner queue still drains', async () => {
    const { world, handle } = setup();
    world.auditError = new Error('audit table unavailable');
    await expect(handle(start('Scout', A))).rejects.toThrow('audit table unavailable');
    world.auditError = null;
    expect(await handle(start('Ranger'))).toEqual(STARTED);
  });

  it('an audit failure after a successful start returns the reply and keeps the started body', async () => {
    const { world, handle } = setup();
    world.auditError = new Error('audit table unavailable');
    expect(await handle(start('Ranger'))).toEqual(STARTED);
    expect(world.specs).toHaveLength(1);
    expect(world.startRows).toHaveLength(1);
    expect(world.bodies.get('ranger')?.running).toBe(true);
  });

  it('an audit failure after a successful start calls onAuditLost with a fixed code, and a refusal does not', async () => {
    const world = new FakeWorld();
    world.addPlayer('Ranger', A);
    world.addPlayer('Scout', B);
    const onAuditLost = vi.fn();
    const sup = createSupervisor({ ...world.deps(), onAuditLost });
    world.auditError = new Error('audit table unavailable');
    expect(await sup.handle(start('Ranger'))).toEqual(STARTED);
    expect(onAuditLost).toHaveBeenCalledTimes(1);
    expect(onAuditLost).toHaveBeenCalledWith({ action: 'body_start', code: 'audit_lost' });
    await expect(sup.handle(start('Scout', A))).rejects.toThrow('audit table unavailable');
    expect(onAuditLost).toHaveBeenCalledTimes(1);
  });

  it('status and logtail are not audited, so polling adds no audit rows', async () => {
    const { world, handle } = setup();
    await handle(start('Ranger'));
    const before = world.auditRows.length;
    for (let i = 0; i < 4; i++) {
      await handle(req('status', A, 'Ranger'));
      await handle(req('logtail', A, 'Ranger'));
    }
    expect(world.auditRows).toHaveLength(before);
  });

  it('a malformed request is refused as invalid and audited without a target', async () => {
    const { world, sup } = setup();
    expect(await sup.handle({ op: 'shutdown', ownerId: A, playerName: 'Ranger' })).toEqual({
      ok: false,
      code: 'invalid',
    });
    expect(world.auditRows.at(-1)?.action).toBe('body_invalid');
    expect(world.auditRows.at(-1)?.target).toBe('invalid');
  });
});

describe('logtail: 200 events at most, none older than 7 days', () => {
  function events(count: number, ageMs: number, now: Date): LogEvent[] {
    return Array.from({ length: count }, (_, i) => ({
      at: new Date(now.getTime() - ageMs + i),
      code: 'other' as const,
    }));
  }

  it('returns the newest 200 of 300 recent events', async () => {
    const { world, handle } = setup();
    await handle(start('Ranger'));
    world.logs.set('ranger', events(300, HOUR_MS, world.now));
    const reply = await handle(req('logtail', A, 'Ranger'));
    expect(reply.ok && reply.events?.length).toBe(200);
  });

  it('drops events older than 7 days, keeps the one exactly at 7 days', async () => {
    const { world, handle } = setup();
    await handle(start('Ranger'));
    const edge = new Date(world.now.getTime() - LOG_TAIL_WINDOW_MS);
    const old = new Date(world.now.getTime() - LOG_TAIL_WINDOW_MS - 1);
    world.logs.set('ranger', [
      { at: old, code: 'started' },
      { at: edge, code: 'stopped' },
      { at: world.now, code: 'started' },
    ]);
    const reply = await handle(req('logtail', A, 'Ranger'));
    expect(reply).toEqual({
      ok: true,
      code: 'logs',
      events: [
        { at: edge, code: 'stopped' },
        { at: world.now, code: 'started' },
      ],
    });
    expect(DAY_MS * 7).toBe(LOG_TAIL_WINDOW_MS);
    expect(LOG_TAIL_LIMIT).toBe(200);
  });
});
